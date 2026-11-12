import { nowFor } from "@/lib/clock";
import { TokenDecryptError } from "@/lib/db/credentials";
import { flagAccount } from "@/lib/db/health";
import { deletePublishedVideo, signVideoUrl } from "@/lib/db/videos";
import { workspaceKindOf } from "@/lib/db/workspaces";
import {
  applyPublishOutcome,
  nextPublishAction,
  quotaWait,
  type PublishAccount,
  type PublishOutcome,
  type PublishPost,
  type PublishResult,
} from "@/lib/domain/publish";
import { createDbFakeStore } from "@/lib/providers/fake-store";
import { instagramConfigFromEnv, type InstagramConfig } from "@/lib/providers/instagram";
import { ProviderError, providerFor, type ProviderPlatform } from "@/lib/providers";
import { claim, release, type Claim } from "./claim";
import { createTokenReader, resolveTokenKey } from "./provider-account";
import { advancePost, errorOutcome } from "./publish-post";
import type { Db, Step, StepSummary, TickContext } from "./types";

/**
 * The publish step: claims due posts and advances each one step through the publish machine
 * (src/lib/domain/publish.ts; the provider calls are in publish-post.ts). Fake-provider posts
 * always; Instagram posts once the Meta app (IG_APP_ID/IG_APP_SECRET/IG_LOGIN_CONFIG_ID) and TOKEN_ENC_KEY are set, so a
 * deployment without them leaves Instagram posts queued instead of failing them.
 */
/** Posts claimed per tick. */
export const PUBLISH_BATCH = 10;

export interface PublishDeps {
  /** The Instagram app; read from the environment when absent (undefined). */
  instagram?: InstagramConfig | null;
  /** TOKEN_ENC_KEY; read from the environment when absent (undefined). */
  tokenKey?: Buffer | null;
  /** A URL Instagram can download the video from (default: a 1-hour signed Storage URL). */
  signVideoUrl?: (db: Db, storagePath: string) => Promise<string>;
}

/** The platforms this deployment can publish to. */
export function publishPlatforms(input: {
  instagram: InstagramConfig | null;
  tokenKey: Buffer | null;
}): ProviderPlatform[] {
  return input.instagram && input.tokenKey ? ["fake", "instagram"] : ["fake"];
}

const POST_COLUMNS =
  "id, workspace_id, account_id, media_id, caption, is_ai_generated, status, container_id, container_created_at, attempts, " +
  "social_accounts(handle, platform, platform_user_id, status, status_reason, slots), " +
  "media_assets(storage_path)";

interface LoadedPost {
  id: string;
  workspace_id: string;
  account_id: string;
  media_id: string;
  caption: string;
  is_ai_generated: boolean;
  status: PublishPost["status"];
  container_id: string | null;
  container_created_at: string | null;
  attempts: number;
  social_accounts: {
    handle: string;
    platform: ProviderPlatform;
    platform_user_id: string | null;
    status: PublishAccount["status"];
    status_reason: string | null;
    slots: string[];
  };
  media_assets: { storage_path: string };
}

export interface WorkspaceSettings {
  now: () => Date;
  timezone: string;
}

const VIDEO_URL_FAILED = new ProviderError({
  code: "network",
  retryable: true,
  userMessage: "Couldn't prepare the video for Instagram. Broadcast will try again.",
});

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
    // Access is gone: the account needs attention and its other queued posts pause too.
    await flagAccount(db, {
      workspaceId: c.workspaceId,
      accountId: post.account_id,
      reason: result.accountProblem,
      kind: "publish",
    });
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

export async function loadSettings(
  db: Db,
  workspaceIds: readonly string[],
): Promise<Map<string, WorkspaceSettings>> {
  const settings = new Map<string, WorkspaceSettings>();
  if (workspaceIds.length === 0) return settings;
  const { data, error } = await db
    .from("settings")
    .select("workspace_id, clock_override, timezone")
    .in("workspace_id", [...workspaceIds]);
  if (error) throw new Error(`Reading workspace settings failed: ${error.message}`);
  for (const row of data) {
    const workspace = {
      kind: workspaceKindOf(row.workspace_id),
      clockOverride: row.clock_override,
    };
    settings.set(row.workspace_id, {
      now: () => nowFor(workspace),
      timezone: row.timezone ?? "UTC",
    });
  }
  return settings;
}

export function createPublishDue(deps: PublishDeps = {}): Step {
  return {
    name: "publishDue",
    async run(ctx: TickContext): Promise<StepSummary> {
      const { db } = ctx;
      const instagram = deps.instagram === undefined ? instagramConfigFromEnv() : deps.instagram;
      const tokenKey = resolveTokenKey(deps.tokenKey);
      const sign = deps.signVideoUrl ?? signVideoUrl;

      const claims = await claim(db, "publish", PUBLISH_BATCH, {
        platforms: publishPlatforms({ instagram, tokenKey }),
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
        tokenErrors: 0,
      };
      if (claims.length === 0) return summary;

      const [posts, settings] = await Promise.all([
        loadPosts(db, claims),
        loadSettings(db, [...new Set(claims.map((c) => c.workspaceId))]),
      ]);
      const fakeStore = createDbFakeStore(db);
      const providerAccount = createTokenReader(db, tokenKey);

      for (const c of claims) {
        const post = posts.get(c.postId);
        if (!post || ctx.realNow().getTime() > ctx.deadline) {
          await release(db, c);
          summary.released += 1;
          continue;
        }
        const ws = settings.get(c.workspaceId) ?? { now: ctx.realNow, timezone: "UTC" };
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
          const provider = providerFor(
            { platform: account.platform },
            { fakeStore, now: ws.now, instagram },
          );
          // Only provider calls need the token (pausing a post doesn't).
          const callsProvider =
            action.kind === "create_container" || action.kind === "check_container";
          outcome = await advancePost({
            provider,
            account: callsProvider
              ? await providerAccount({
                  id: post.account_id,
                  workspaceId: post.workspace_id,
                  platform: account.platform,
                  platformUserId: account.platform_user_id,
                })
              : { accountId: post.account_id, platformUserId: null, accessToken: "" },
            post: stepPost(post),
            action,
            videoUrl: async () => {
              // The fake provider never downloads; Instagram gets a signed Storage URL.
              if (account.platform === "fake") return post.media_assets.storage_path;
              try {
                return await sign(db, post.media_assets.storage_path);
              } catch (err) {
                console.error(`publishDue: post ${post.id}:`, err);
                throw VIDEO_URL_FAILED;
              }
            },
            quotaWait: () =>
              quotaWait({ slots: account.slots, timezone: ws.timezone, now: ws.now() }),
          });
        } catch (err) {
          if (err instanceof TokenDecryptError) {
            // TOKEN_ENC_KEY doesn't open the stored token: a server misconfiguration, not the
            // account's fault. Leave the post untouched (no retry used, no pause) and say so.
            console.error(
              `publishDue: post ${post.id}: the account's token can't be decrypted. Check TOKEN_ENC_KEY.`,
            );
            await release(db, c);
            summary.tokenErrors += 1;
            continue;
          }
          outcome = errorOutcome(err);
        }
        if (!outcome) {
          await release(db, c);
          summary.released += 1;
          continue;
        }

        const result = applyPublishOutcome(machinePost, outcome, ws.now());
        if (!(await save(db, c, post, result))) {
          summary.lost += 1;
          continue;
        }
        switch (outcome.kind) {
          case "published":
            summary.published += 1;
            // The video isn't needed any more (the thumbnail stays). Best effort.
            await deletePublishedVideo(db, {
              workspaceId: post.workspace_id,
              mediaId: post.media_id,
              postId: post.id,
              storagePath: post.media_assets.storage_path,
            });
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
}

function stepPost(post: LoadedPost) {
  return {
    id: post.id,
    handle: post.social_accounts.handle,
    caption: post.caption,
    isAiGenerated: post.is_ai_generated,
    containerCreatedAt: post.container_created_at ? new Date(post.container_created_at) : null,
  };
}

/** The tick's publish step, configured from the environment. */
export const publishDue: Step = createPublishDue();
