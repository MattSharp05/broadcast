import { nowFor } from "@/lib/clock";
import { workspaceKindOf } from "@/lib/db/workspaces";
import {
  applyPublishOutcome,
  nextPublishAction,
  type PublishAccount,
  type PublishErrorCode,
  type PublishOutcome,
  type PublishPost,
  type PublishResult,
} from "@/lib/domain/publish";
import { createDbFakeStore } from "@/lib/providers/fake-store";
import {
  ProviderError,
  providerFor,
  type ProviderAccount,
  type ProviderPlatform,
  type SocialProvider,
} from "@/lib/providers";
import { claim, release, type Claim } from "./claim";
import type { Db, Step, StepSummary, TickContext } from "./types";

/**
 * The publish step: claims due posts and advances each one step through the publish machine
 * (src/lib/domain/publish.ts). BC-12 publishes fake-provider posts only; Instagram (BC-16) adds
 * its platform here once the step can sign video URLs and load decrypted tokens.
 */
export const PUBLISH_PLATFORMS: readonly ProviderPlatform[] = ["fake"];
/** Posts claimed per tick. */
export const PUBLISH_BATCH = 10;

const POST_COLUMNS =
  "id, workspace_id, account_id, caption, status, container_id, attempts, " +
  "social_accounts(handle, platform, platform_user_id, status, status_reason), " +
  "media_assets(storage_path)";

interface LoadedPost {
  id: string;
  workspace_id: string;
  account_id: string;
  caption: string;
  status: PublishPost["status"];
  container_id: string | null;
  attempts: number;
  social_accounts: {
    handle: string;
    platform: ProviderPlatform;
    platform_user_id: string | null;
    status: PublishAccount["status"];
    status_reason: string | null;
  };
  media_assets: { storage_path: string };
}

const UNKNOWN_ERROR = "Something went wrong while posting. Broadcast will try again.";

function errorOutcome(err: unknown, dropContainer = false): PublishOutcome {
  if (err instanceof ProviderError) {
    if (err.code === "quota_exhausted") return { kind: "quota_full", message: err.userMessage };
    if (err.code === "not_ready") return { kind: "processing" };
    return {
      kind: "error",
      code: err.code as PublishErrorCode,
      retryable: err.retryable,
      message: err.userMessage,
      dropContainer: dropContainer || err.code === "not_found",
    };
  }
  return { kind: "error", code: "unknown", retryable: true, message: UNKNOWN_ERROR };
}

/** Runs the provider calls for one action and describes what happened. Never throws. */
async function perform(
  provider: SocialProvider,
  account: ProviderAccount,
  post: LoadedPost,
  action: ReturnType<typeof nextPublishAction>,
): Promise<PublishOutcome | null> {
  try {
    switch (action.kind) {
      case "none":
        return null;
      case "pause":
        return { kind: "paused", reason: action.reason };
      case "create_container": {
        // CLAUDE.md → Rules: check the account's quota before publishing.
        const quota = await provider.getPublishingQuota(account);
        if (quota.used >= quota.limit) {
          return {
            kind: "quota_full",
            message: `@${post.social_accounts.handle} has used its ${quota.windowHours}-hour publishing limit (${quota.used} of ${quota.limit}). Posting resumes when it frees up.`,
          };
        }
        const { containerId } = await provider.createReelContainer(account, {
          videoUrl: post.media_assets.storage_path,
          caption: post.caption,
        });
        return { kind: "container_created", containerId };
      }
      case "check_container": {
        const status = await provider.getContainerStatus(account, action.containerId);
        if (status.state === "in_progress") return { kind: "processing" };
        if (status.state === "error") return errorOutcome(status.error, true);
        const media = await provider.publishContainer(account, action.containerId);
        return { kind: "published", mediaId: media.mediaId, permalink: media.permalink };
      }
    }
  } catch (err) {
    if (!(err instanceof ProviderError)) {
      console.error(`publishDue: post ${post.id}:`, err);
    }
    return errorOutcome(err);
  }
}

/** Saves the step's result, only while this tick still holds the claim. False if it lost it. */
async function save(db: Db, c: Claim, post: LoadedPost, result: PublishResult): Promise<boolean> {
  const { data, error } = await db
    .from("posts")
    .update({ ...result.patch, claimed_until: null, claim_token: null })
    .eq("workspace_id", c.workspaceId)
    .eq("id", c.postId)
    .eq("claim_token", c.token)
    .select("id");
  if (error) throw new Error(`Saving post ${c.postId} failed: ${error.message}`);
  if (data.length === 0) return false;

  const log = await db.from("job_log").insert({
    workspace_id: c.workspaceId,
    kind: "publish",
    post_id: post.id,
    account_id: post.account_id,
    ok: result.log.ok,
    message: result.log.message,
  });
  if (log.error) throw new Error(`Writing the job log failed: ${log.error.message}`);

  if (result.accountProblem) {
    const acc = await db
      .from("social_accounts")
      .update({ status: "needs_attention", status_reason: result.accountProblem })
      .eq("workspace_id", c.workspaceId)
      .eq("id", post.account_id);
    if (acc.error) throw new Error(`Flagging the account failed: ${acc.error.message}`);
  }
  return true;
}

async function loadPosts(db: Db, claims: readonly Claim[]): Promise<Map<string, LoadedPost>> {
  const byWorkspace = new Map<string, string[]>();
  for (const c of claims) {
    byWorkspace.set(c.workspaceId, [...(byWorkspace.get(c.workspaceId) ?? []), c.postId]);
  }
  const posts = new Map<string, LoadedPost>();
  for (const [workspaceId, ids] of byWorkspace) {
    const { data, error } = await db
      .from("posts")
      .select(POST_COLUMNS)
      .eq("workspace_id", workspaceId)
      .in("id", ids)
      .overrideTypes<LoadedPost[], { merge: false }>();
    if (error) throw new Error(`Loading claimed posts failed: ${error.message}`);
    for (const p of data) posts.set(p.id, p);
  }
  return posts;
}

async function loadClocks(
  db: Db,
  workspaceIds: readonly string[],
): Promise<Map<string, () => Date>> {
  const clocks = new Map<string, () => Date>();
  if (workspaceIds.length === 0) return clocks;
  const { data, error } = await db
    .from("settings")
    .select("workspace_id, clock_override")
    .in("workspace_id", [...workspaceIds]);
  if (error) throw new Error(`Reading workspace clocks failed: ${error.message}`);
  for (const row of data) {
    const workspace = {
      kind: workspaceKindOf(row.workspace_id),
      clockOverride: row.clock_override,
    };
    clocks.set(row.workspace_id, () => nowFor(workspace));
  }
  return clocks;
}

export const publishDue: Step = {
  name: "publishDue",
  async run(ctx: TickContext): Promise<StepSummary> {
    const { db } = ctx;
    const claims = await claim(db, "publish", PUBLISH_BATCH, {
      platforms: PUBLISH_PLATFORMS,
      workspaceIds: ctx.workspaceIds,
    });
    const summary = {
      claimed: claims.length,
      published: 0,
      uploaded: 0,
      processing: 0,
      waiting: 0,
      retrying: 0,
      failed: 0,
      paused: 0,
      released: 0,
      lost: 0,
    };
    if (claims.length === 0) return summary;

    const [posts, clocks] = await Promise.all([
      loadPosts(db, claims),
      loadClocks(db, [...new Set(claims.map((c) => c.workspaceId))]),
    ]);
    const fakeStore = createDbFakeStore(db);

    for (const c of claims) {
      const post = posts.get(c.postId);
      if (!post || ctx.realNow().getTime() > ctx.deadline) {
        await release(db, c);
        summary.released += 1;
        continue;
      }
      const now = clocks.get(c.workspaceId) ?? ctx.realNow;
      const account = post.social_accounts;
      const machinePost: PublishPost = {
        status: post.status,
        containerId: post.container_id,
        attempts: post.attempts,
      };
      const action = nextPublishAction(machinePost, {
        handle: account.handle,
        status: account.status,
        statusReason: account.status_reason,
      });

      let outcome: PublishOutcome | null;
      try {
        const provider = providerFor({ platform: account.platform }, { fakeStore, now });
        // The fake provider ignores the token; Instagram (BC-16) loads and decrypts it here.
        const providerAccount: ProviderAccount = {
          accountId: post.account_id,
          platformUserId: account.platform_user_id,
          accessToken: "",
        };
        outcome = await perform(provider, providerAccount, post, action);
      } catch (err) {
        outcome = errorOutcome(err);
      }
      if (!outcome) {
        await release(db, c);
        summary.released += 1;
        continue;
      }

      const result = applyPublishOutcome(machinePost, outcome, now());
      if (!(await save(db, c, post, result))) {
        summary.lost += 1;
        continue;
      }
      switch (outcome.kind) {
        case "published":
          summary.published += 1;
          break;
        case "container_created":
          summary.uploaded += 1;
          break;
        case "processing":
          summary.processing += 1;
          break;
        case "quota_full":
          summary.waiting += 1;
          break;
        case "paused":
          summary.paused += 1;
          break;
        case "error":
          if (result.patch.status === "failed") summary.failed += 1;
          else if (result.patch.status === "paused") summary.paused += 1;
          else summary.retrying += 1;
          break;
      }
    }
    return summary;
  },
};
