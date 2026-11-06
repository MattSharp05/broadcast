import { hasTokenKey, tokenKeyFromEnv } from "@/lib/crypto/tokens";
import { TokenDecryptError, loadAccessToken } from "@/lib/db/credentials";
import type { StatOffset } from "@/lib/domain/details";
import { dueSnapshots, followerDay, statDueAt } from "@/lib/domain/stats-schedule";
import { createDbFakeStore } from "@/lib/providers/fake-store";
import { instagramConfigFromEnv, type InstagramConfig } from "@/lib/providers/instagram";
import {
  ProviderError,
  providerFor,
  type MediaInsights,
  type ProviderAccount,
  type ProviderPlatform,
  type SocialProvider,
} from "@/lib/providers";
import { claim, release, type Claim } from "./claim";
import { loadSettings, publishPlatforms, type WorkspaceSettings } from "./publish-due";
import type { Db, Step, StepSummary, TickContext } from "./types";

/**
 * The stats step (BC-21). Runs after publishing, in what is left of the tick's budget:
 *
 * 1. Snapshots: claims up to STATS_BATCH published posts with a snapshot due (claim_work 'stats')
 *    and makes one insights call per post. The numbers go to the latest due offset; earlier ones
 *    that came due while the scheduler was down are marked missed (src/lib/domain/stats-schedule).
 * 2. Followers: once a day per ready account (the workspace's local day), up to FOLLOWERS_BATCH
 *    accounts per tick: account_metrics for today and social_accounts.followers.
 *
 * Rate limits: a few calls per tick at most; a failed post backs off (its claim lease is extended
 * instead of released), a rate-limited account is left alone for the rest of the tick and backs
 * off for an hour, and an account whose follower count failed isn't asked again for an hour.
 * A failure here never affects publishing: that step has already run.
 */

/** Posts whose stats are fetched per tick. */
export const STATS_BATCH = 5;
/** Accounts whose follower count is fetched per tick. */
export const FOLLOWERS_BATCH = 5;
/** Don't start a call with less than this left of the tick's budget. */
const MIN_CALL_MS = 3_000;
const CALL_TIMEOUT_MS = 15_000;
const MINUTE_S = 60;
/** Back-off after a failure that may pass (network, Instagram having a problem). */
export const RETRY_BACKOFF_S = 15 * MINUTE_S;
/** Back-off after a rate limit, an expired token or an unreadable token. */
export const LONG_BACKOFF_S = 60 * MINUTE_S;
const FOLLOWERS_RETRY_MS = 60 * 60_000;

export interface CollectStatsDeps {
  /** The Instagram app; read from the environment when absent (undefined). */
  instagram?: InstagramConfig | null;
  /** TOKEN_ENC_KEY; read from the environment when absent (undefined). */
  tokenKey?: Buffer | null;
}

interface LoadedPost {
  id: string;
  workspace_id: string;
  account_id: string;
  media_ig_id: string | null;
  published_at: string | null;
  social_accounts: { handle: string; platform: ProviderPlatform; platform_user_id: string | null };
  post_metrics: { stat_offset: StatOffset; due_at: string; taken_at: string | null }[];
}

interface AccountRow {
  id: string;
  workspace_id: string;
  platform: ProviderPlatform;
  platform_user_id: string | null;
}

type MetricWrite = MediaInsights & { missed: boolean };

interface StatsSummary {
  claimed: number;
  collected: number;
  missed: number;
  retrying: number;
  released: number;
  followers: number;
  followerErrors: number;
}

const NO_NUMBERS: MediaInsights = {
  views: null,
  reach: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
};

/** Tokens per account, read once per tick. */
function tokenReader(db: Db, tokenKey: Buffer | null) {
  const tokens = new Map<string, Promise<string | null>>();
  return async (account: AccountRow): Promise<ProviderAccount> => {
    const base = { accountId: account.id, platformUserId: account.platform_user_id };
    if (account.platform === "fake") return { ...base, accessToken: "" };
    let token = tokens.get(account.id);
    if (!token) {
      token = tokenKey
        ? loadAccessToken(db, account.workspace_id, account.id, tokenKey)
        : Promise.resolve(null);
      tokens.set(account.id, token);
    }
    const accessToken = await token;
    if (!accessToken) {
      throw new ProviderError({
        code: "token_expired",
        retryable: false,
        userMessage: "Broadcast has no working Instagram access for this account.",
      });
    }
    return { ...base, accessToken };
  };
}

/** How long to leave a post alone after a failed stats call. */
export function backoffFor(err: unknown): number {
  if (err instanceof ProviderError && err.retryable && err.code !== "quota_exhausted") {
    return RETRY_BACKOFF_S;
  }
  return LONG_BACKOFF_S;
}

function errorText(err: unknown): string {
  if (err instanceof ProviderError) return err.userMessage;
  return err instanceof Error ? err.message : String(err);
}

/** Keeps the post leased for `seconds` (the back-off) and drops this tick's claim. */
async function backOff(db: Db, c: Claim, seconds: number, realNow: Date): Promise<void> {
  const { error } = await db
    .from("posts")
    .update({
      claimed_until: new Date(realNow.getTime() + seconds * 1000).toISOString(),
      claim_token: null,
    })
    .eq("workspace_id", c.workspaceId)
    .eq("id", c.postId)
    .eq("claim_token", c.token);
  if (error) throw new Error(`Backing off post ${c.postId} failed: ${error.message}`);
}

async function writeSnapshots(
  db: Db,
  post: LoadedPost,
  writes: ReadonlyMap<StatOffset, MetricWrite>,
  takenAt: Date,
): Promise<void> {
  const dueAt = new Map(post.post_metrics.map((m) => [m.stat_offset, m.due_at]));
  const publishedAt = new Date(post.published_at ?? takenAt);
  const rows = [...writes].map(([offset, w]) => ({
    workspace_id: post.workspace_id,
    post_id: post.id,
    stat_offset: offset,
    due_at: dueAt.get(offset) ?? statDueAt(publishedAt, offset).toISOString(),
    taken_at: takenAt.toISOString(),
    ...w,
  }));
  if (rows.length === 0) return;
  const { error } = await db
    .from("post_metrics")
    .upsert(rows, { onConflict: "post_id,stat_offset" });
  if (error) throw new Error(`Saving stats for post ${post.id} failed: ${error.message}`);
}

async function logFailure(
  db: Db,
  kind: "stats" | "followers",
  workspaceId: string,
  accountId: string,
  postId: string | null,
  message: string,
): Promise<void> {
  const { error } = await db.from("job_log").insert({
    workspace_id: workspaceId,
    kind,
    post_id: postId,
    account_id: accountId,
    ok: false,
    message,
  });
  if (error) console.error(`collectStats: writing the job log failed: ${error.message}`);
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
      .select(
        "id, workspace_id, account_id, media_ig_id, published_at, " +
          "social_accounts(handle, platform, platform_user_id), post_metrics(stat_offset, due_at, taken_at)",
      )
      .eq("workspace_id", workspaceId)
      .in("id", ids)
      .overrideTypes<LoadedPost[], { merge: false }>();
    if (error) throw new Error(`Loading posts for stats failed: ${error.message}`);
    for (const p of data) posts.set(p.id, p);
  }
  return posts;
}

interface Run {
  db: Db;
  ctx: TickContext;
  instagram: InstagramConfig | null;
  platforms: ProviderPlatform[];
  settings: Map<string, WorkspaceSettings>;
  providerAccount: (account: AccountRow) => Promise<ProviderAccount>;
  fakeStore: ReturnType<typeof createDbFakeStore>;
  /** Accounts Instagram rate-limited this tick: left alone for the rest of it. */
  limited: Set<string>;
}

/** ms left in the tick's budget. */
function remaining(ctx: TickContext): number {
  return ctx.deadline - ctx.realNow().getTime();
}

function providerOf(run: Run, platform: ProviderPlatform, ws: WorkspaceSettings): SocialProvider {
  return providerFor(
    { platform },
    {
      fakeStore: run.fakeStore,
      now: ws.now,
      instagram: run.instagram,
      timeoutMs: Math.max(1_000, Math.min(CALL_TIMEOUT_MS, remaining(run.ctx) - 1_000)),
    },
  );
}

function workspaceOf(run: Run, workspaceId: string): WorkspaceSettings {
  return run.settings.get(workspaceId) ?? { now: run.ctx.realNow, timezone: "UTC" };
}

async function collectSnapshots(run: Run, summary: StatsSummary): Promise<void> {
  const { db, ctx } = run;
  const claims = await claim(db, "stats", STATS_BATCH, {
    platforms: run.platforms,
    workspaceIds: ctx.workspaceIds,
  });
  summary.claimed = claims.length;
  if (claims.length === 0) return;

  const posts = await loadPosts(db, claims);
  for (const [id, s] of await loadSettings(db, [...new Set(claims.map((c) => c.workspaceId))])) {
    run.settings.set(id, s);
  }
  for (const c of claims) {
    const post = posts.get(c.postId);
    if (!post || run.limited.has(post.account_id) || remaining(ctx) < MIN_CALL_MS) {
      await release(db, c);
      summary.released += 1;
      continue;
    }
    const ws = workspaceOf(run, c.workspaceId);
    const now = ws.now();
    const plan = dueSnapshots({
      publishedAt: post.published_at ? new Date(post.published_at) : null,
      rows: post.post_metrics.map((m) => ({
        offset: m.stat_offset,
        dueAt: new Date(m.due_at),
        takenAt: m.taken_at ? new Date(m.taken_at) : null,
      })),
      now,
    });
    if (!plan.take) {
      await release(db, c);
      summary.released += 1;
      continue;
    }

    const writes = new Map<StatOffset, MetricWrite>();
    for (const o of plan.missed) writes.set(o, { ...NO_NUMBERS, missed: true });
    try {
      if (!post.media_ig_id) {
        // Published, but its answer was lost and the post couldn't be found: no id to ask about.
        throw new ProviderError({
          code: "not_found",
          retryable: false,
          userMessage: "Broadcast doesn't know this post's Instagram id, so it has no stats.",
        });
      }
      const account: AccountRow = {
        id: post.account_id,
        workspace_id: post.workspace_id,
        platform: post.social_accounts.platform,
        platform_user_id: post.social_accounts.platform_user_id,
      };
      const provider = providerOf(run, account.platform, ws);
      const insights = await provider.getMediaInsights(
        await run.providerAccount(account),
        post.media_ig_id,
      );
      writes.set(plan.take, { ...insights, missed: false });
    } catch (err) {
      if (err instanceof ProviderError && err.code === "not_found") {
        // The post is gone (or has no id): its due snapshots will never come. Mark them missed.
        writes.set(plan.take, { ...NO_NUMBERS, missed: true });
        summary.missed += 1;
        await logFailure(db, "stats", post.workspace_id, post.account_id, post.id, errorText(err));
      } else {
        if (err instanceof TokenDecryptError) {
          console.error(`collectStats: post ${post.id}: the token can't be decrypted.`);
        } else if (!(err instanceof ProviderError)) {
          console.error(`collectStats: post ${post.id}:`, err);
        }
        if (err instanceof ProviderError && err.code === "quota_exhausted") {
          run.limited.add(post.account_id);
        }
        await logFailure(db, "stats", post.workspace_id, post.account_id, post.id, errorText(err));
        await backOff(db, c, backoffFor(err), ctx.realNow());
        summary.retrying += 1;
        continue;
      }
    }
    await writeSnapshots(db, post, writes, now);
    if (!writes.get(plan.take)?.missed) summary.collected += 1;
    summary.missed += plan.missed.length;
    await release(db, c);
  }
}

async function collectFollowers(run: Run, summary: StatsSummary): Promise<void> {
  const { db, ctx } = run;
  if (remaining(ctx) < MIN_CALL_MS) return;

  let query = db
    .from("social_accounts")
    .select("id, workspace_id, platform, platform_user_id")
    .eq("status", "ready")
    .in("platform", run.platforms)
    .order("id");
  if (ctx.workspaceIds) query = query.in("workspace_id", [...ctx.workspaceIds]);
  const accounts = await query;
  if (accounts.error) throw new Error(`Loading accounts failed: ${accounts.error.message}`);
  if (accounts.data.length === 0) return;

  const ids = accounts.data.map((a) => a.id);
  const workspaces = [...new Set(accounts.data.map((a) => a.workspace_id))];
  const missing = workspaces.filter((id) => !run.settings.has(id));
  for (const [id, s] of await loadSettings(db, missing)) run.settings.set(id, s);
  const today = new Map(
    accounts.data.map((a) => [
      a.id,
      followerDay(
        workspaceOf(run, a.workspace_id).now(),
        workspaceOf(run, a.workspace_id).timezone,
      ),
    ]),
  );
  const [recorded, failed] = await Promise.all([
    db
      .from("account_metrics")
      .select("account_id, day")
      .in("workspace_id", workspaces)
      .in("account_id", ids)
      .in("day", [...new Set(today.values())]),
    db
      .from("job_log")
      .select("account_id")
      .in("workspace_id", workspaces)
      .eq("kind", "followers")
      .eq("ok", false)
      .in("account_id", ids)
      .gte("at", new Date(ctx.realNow().getTime() - FOLLOWERS_RETRY_MS).toISOString()),
  ]);
  if (recorded.error) throw new Error(`Loading follower days failed: ${recorded.error.message}`);
  if (failed.error) throw new Error(`Loading the job log failed: ${failed.error.message}`);
  const done = new Set(
    recorded.data.filter((r) => today.get(r.account_id) === r.day).map((r) => r.account_id),
  );
  const waiting = new Set(failed.data.map((f) => f.account_id));
  const due = accounts.data
    .filter((a) => !done.has(a.id) && !waiting.has(a.id) && !run.limited.has(a.id))
    .slice(0, FOLLOWERS_BATCH);

  for (const a of due) {
    if (remaining(ctx) < MIN_CALL_MS) break;
    const ws = workspaceOf(run, a.workspace_id);
    const day = today.get(a.id) ?? followerDay(ws.now(), ws.timezone);
    let followers: number;
    try {
      const provider = providerOf(run, a.platform, ws);
      followers = await provider.getFollowerCount(await run.providerAccount(a));
    } catch (err) {
      if (!(err instanceof ProviderError)) console.error(`collectStats: account ${a.id}:`, err);
      await logFailure(db, "followers", a.workspace_id, a.id, null, errorText(err));
      summary.followerErrors += 1;
      continue;
    }
    const count = Math.max(0, Math.round(followers));
    const metric = await db
      .from("account_metrics")
      .upsert(
        { workspace_id: a.workspace_id, account_id: a.id, day, followers: count },
        { onConflict: "account_id,day" },
      );
    if (metric.error) throw new Error(`Saving followers failed: ${metric.error.message}`);
    const acc = await db
      .from("social_accounts")
      .update({ followers: count })
      .eq("workspace_id", a.workspace_id)
      .eq("id", a.id);
    if (acc.error) throw new Error(`Updating followers failed: ${acc.error.message}`);
    summary.followers += 1;
  }
}

export function createCollectStats(deps: CollectStatsDeps = {}): Step {
  return {
    name: "collectStats",
    async run(ctx: TickContext): Promise<StepSummary> {
      const instagram = deps.instagram === undefined ? instagramConfigFromEnv() : deps.instagram;
      const tokenKey =
        deps.tokenKey === undefined ? (hasTokenKey() ? tokenKeyFromEnv() : null) : deps.tokenKey;
      const run: Run = {
        db: ctx.db,
        ctx,
        instagram,
        platforms: publishPlatforms({ instagram, tokenKey }),
        settings: new Map(),
        providerAccount: tokenReader(ctx.db, tokenKey),
        fakeStore: createDbFakeStore(ctx.db),
        limited: new Set(),
      };
      const summary: StatsSummary = {
        claimed: 0,
        collected: 0,
        missed: 0,
        retrying: 0,
        released: 0,
        followers: 0,
        followerErrors: 0,
      };
      await collectSnapshots(run, summary);
      await collectFollowers(run, summary);
      return { ...summary };
    },
  };
}

/** The tick's stats step, configured from the environment. */
export const collectStats: Step = createCollectStats();
