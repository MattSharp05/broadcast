import { credentialContext, encryptToken } from "@/lib/crypto/tokens";
import { TokenDecryptError } from "@/lib/db/credentials";
import { flagAccount } from "@/lib/db/health";
import {
  REFRESH_MIN_AGE_MS,
  REFRESH_RETRY_MS,
  REFRESH_WINDOW_MS,
  connectionCheckDue,
  expiredReason,
  reconnectLaterLine,
  reconnectSoonReason,
  refreshFailedReason,
  refreshFailure,
  refreshPlan,
  unrenewablePlan,
} from "@/lib/domain/health";
import { createDbFakeStore } from "@/lib/providers/fake-store";
import { instagramConfigFromEnv, type InstagramConfig } from "@/lib/providers/instagram";
import { ProviderError, providerFor, type ProviderPlatform, type TokenSet } from "@/lib/providers";
import { errorText, isAuthError } from "@/lib/providers/errors";
import { loadSettings, publishPlatforms, type WorkspaceSettings } from "./publish-due";
import { createTokenReader, resolveTokenKey, type TokenAccount } from "./provider-account";
import type { Db, Step, StepSummary, TickContext } from "./types";

/**
 * The refreshTokens step (BC-19), after publishing and stats:
 *
 * 1. Refresh: claims up to REFRESH_BATCH credentials whose token is due a refresh (older than
 *    24 h, expiring within 7 days; `claim_refresh`, migration 0008) and asks the platform for a
 *    new one. A token that already expired, or a refresh refused because access is gone, flags the
 *    account Needs attention and pauses its queued posts. One that may pass retries in an hour.
 *    A token the platform won't renew (Instagram through Facebook Login, ADR 0006) waits until
 *    3 days before it expires, then flags the account with the date: a Reconnect renews it.
 * 2. Connection check: up to CHECK_BATCH ready Instagram accounts not checked in the last minute
 *    get one cheap read (the publishing quota, which also needs the publish permission). An auth
 *    error flags the account, so revoking Broadcast in Instagram shows within a couple of minutes.
 *    Other failures are ignored here (publishing and stats handle their own).
 *
 * Fake (Sandbox) accounts are refreshed but not checked: their failure modes are scripted for the
 * calls a scenario expects.
 */

export const REFRESH_BATCH = 5;
export const CHECK_BATCH = 5;
const MIN_CALL_MS = 3_000;
const CALL_TIMEOUT_MS = 15_000;

export interface RefreshDeps {
  /** The Instagram app; read from the environment when absent (undefined). */
  instagram?: InstagramConfig | null;
  /** TOKEN_ENC_KEY; read from the environment when absent (undefined). */
  tokenKey?: Buffer | null;
}

interface CredentialRow {
  account_id: string;
  workspace_id: string;
  expires_at: string | null;
  last_refreshed_at: string | null;
  checked_at: string | null;
  refresh_claim_token: string | null;
  social_accounts: {
    handle: string;
    platform: ProviderPlatform;
    platform_user_id: string | null;
    status: string;
  };
}

const CREDENTIAL_COLUMNS =
  "account_id, workspace_id, expires_at, last_refreshed_at, checked_at, refresh_claim_token, " +
  "social_accounts!inner(handle, platform, platform_user_id, status)";

interface Run {
  db: Db;
  ctx: TickContext;
  instagram: InstagramConfig | null;
  tokenKey: Buffer | null;
  platforms: ProviderPlatform[];
  reader: ReturnType<typeof createTokenReader>;
  fakeStore: ReturnType<typeof createDbFakeStore>;
  settings: Map<string, WorkspaceSettings>;
}

interface Summary {
  claimed: number;
  refreshed: number;
  expired: number;
  retrying: number;
  flagged: number;
  released: number;
  tokenErrors: number;
  checked: number;
  /** Tokens that can't be renewed and aren't close enough to expiry to ask for a reconnect. */
  waiting: number;
}

function remaining(ctx: TickContext): number {
  return ctx.deadline - ctx.realNow().getTime();
}

function tokenAccount(row: CredentialRow): TokenAccount {
  return {
    id: row.account_id,
    workspaceId: row.workspace_id,
    platform: row.social_accounts.platform,
    platformUserId: row.social_accounts.platform_user_id,
  };
}

function workspaceOf(run: Run, workspaceId: string): WorkspaceSettings {
  return run.settings.get(workspaceId) ?? { now: run.ctx.realNow, timezone: "UTC" };
}

function providerOf(run: Run, platform: ProviderPlatform, ws: WorkspaceSettings) {
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

async function log(db: Db, row: CredentialRow, ok: boolean, message: string): Promise<void> {
  const { error } = await db.from("job_log").insert({
    workspace_id: row.workspace_id,
    kind: "refresh",
    account_id: row.account_id,
    ok,
    message,
  });
  if (error) console.error(`refreshTokens: writing the job log failed: ${error.message}`);
}

/** Drops this tick's lease on a credential, optionally with a retry time. */
async function release(
  db: Db,
  row: CredentialRow,
  token: string,
  retryAt: Date | null = null,
): Promise<void> {
  const { error } = await db
    .from("oauth_credentials")
    .update({
      refresh_claimed_until: null,
      refresh_claim_token: null,
      ...(retryAt ? { refresh_retry_at: retryAt.toISOString() } : {}),
    })
    .eq("workspace_id", row.workspace_id)
    .eq("account_id", row.account_id)
    .eq("refresh_claim_token", token);
  if (error) throw new Error(`Releasing a refresh claim failed: ${error.message}`);
}

/** Stores the new token (encrypted) and its expiry, only while this tick holds the lease. */
async function saveTokens(
  run: Run,
  row: CredentialRow,
  token: string,
  tokens: TokenSet,
  now: Date,
): Promise<boolean> {
  const sealed = run.tokenKey
    ? encryptToken(tokens.accessToken, run.tokenKey, credentialContext(row.account_id))
    : null;
  if (!sealed && row.social_accounts.platform !== "fake") {
    // Can't happen (Instagram is only refreshed with a key), but never store a token in clear.
    throw new Error("refreshTokens: no TOKEN_ENC_KEY to store the new token with.");
  }
  const { data, error } = await run.db
    .from("oauth_credentials")
    .update({
      ...(sealed ? { access_token_enc: sealed } : {}),
      expires_at: tokens.expiresAt.toISOString(),
      last_refreshed_at: now.toISOString(),
      // A platform may leave the permissions out: empty means unchanged.
      ...(tokens.scopes.length > 0 ? { scopes: [...tokens.scopes] } : {}),
      refresh_retry_at: null,
      refresh_claimed_until: null,
      refresh_claim_token: null,
      checked_at: run.ctx.realNow().toISOString(),
    })
    .eq("workspace_id", row.workspace_id)
    .eq("account_id", row.account_id)
    .eq("refresh_claim_token", token)
    .select("account_id");
  if (error) throw new Error(`Saving the refreshed token failed: ${error.message}`);
  return data.length > 0;
}

async function flag(run: Run, row: CredentialRow, reason: string, kind: string): Promise<void> {
  await flagAccount(run.db, {
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    reason,
    kind,
  });
}

async function refreshDue(run: Run, summary: Summary): Promise<void> {
  const { db, ctx } = run;
  const { data: claims, error } = await db.rpc("claim_refresh", {
    p_limit: REFRESH_BATCH,
    p_platforms: run.platforms,
    p_min_age_seconds: REFRESH_MIN_AGE_MS / 1000,
    p_window_seconds: REFRESH_WINDOW_MS / 1000,
    ...(ctx.workspaceIds ? { p_workspace_ids: [...ctx.workspaceIds] } : {}),
  });
  if (error) throw new Error(`Claiming tokens to refresh failed: ${error.message}`);
  summary.claimed = claims.length;
  if (claims.length === 0) return;

  const rows = new Map<string, CredentialRow>();
  for (const workspaceId of new Set(claims.map((c) => c.workspace_id))) {
    const res = await db
      .from("oauth_credentials")
      .select(CREDENTIAL_COLUMNS)
      .eq("workspace_id", workspaceId)
      .in(
        "account_id",
        claims.filter((c) => c.workspace_id === workspaceId).map((c) => c.account_id),
      )
      .overrideTypes<CredentialRow[], { merge: false }>();
    if (res.error) throw new Error(`Loading credentials failed: ${res.error.message}`);
    for (const r of res.data) rows.set(r.account_id, r);
  }
  for (const [id, s] of await loadSettings(db, [...new Set(claims.map((c) => c.workspace_id))])) {
    run.settings.set(id, s);
  }

  for (const c of claims) {
    const row = rows.get(c.account_id);
    if (!row) continue;
    if (remaining(ctx) < MIN_CALL_MS) {
      await release(db, row, c.claim_token);
      summary.released += 1;
      continue;
    }
    const ws = workspaceOf(run, row.workspace_id);
    const now = ws.now();
    const plan = refreshPlan(
      {
        lastRefreshedAt: row.last_refreshed_at ? new Date(row.last_refreshed_at) : null,
        expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      },
      now,
    );
    if (plan === "none") {
      await release(db, row, c.claim_token);
      summary.released += 1;
      continue;
    }
    if (plan === "expired") {
      await flag(run, row, expiredReason(new Date(row.expires_at ?? now), ws.timezone), "refresh");
      await release(db, row, c.claim_token);
      summary.expired += 1;
      summary.flagged += 1;
      continue;
    }

    let tokens: TokenSet;
    try {
      const provider = providerOf(run, row.social_accounts.platform, ws);
      tokens = await provider.refreshToken(await run.reader(tokenAccount(row)));
    } catch (err) {
      if (err instanceof TokenDecryptError) {
        // TOKEN_ENC_KEY doesn't open the stored token: a server problem, not the account's.
        console.error(`refreshTokens: account ${row.account_id}: the token can't be decrypted.`);
        await release(db, row, c.claim_token, new Date(ctx.realNow().getTime() + REFRESH_RETRY_MS));
        summary.tokenErrors += 1;
        continue;
      }
      if (err instanceof ProviderError && err.code === "not_renewable") {
        const expiresAt = new Date(row.expires_at ?? now);
        const plan = unrenewablePlan(expiresAt, now);
        if (plan.action === "flag") {
          await flag(run, row, reconnectSoonReason(expiresAt, ws.timezone), "refresh");
          await release(db, row, c.claim_token);
          summary.flagged += 1;
        } else {
          // Ask again when the notice period starts (real time: the lease and retry are real).
          const waitMs = plan.askAt.getTime() - now.getTime();
          await log(
            db,
            row,
            true,
            reconnectLaterLine(row.social_accounts.handle, plan.askAt, ws.timezone),
          );
          await release(db, row, c.claim_token, new Date(ctx.realNow().getTime() + waitMs));
          summary.waiting += 1;
        }
        continue;
      }
      if (!(err instanceof ProviderError)) console.error(`refreshTokens: ${row.account_id}:`, err);
      const failure =
        err instanceof ProviderError
          ? refreshFailure(err)
          : refreshFailure({ code: "unknown", retryable: true });
      if (failure === "flag") {
        await flag(run, row, refreshFailedReason(errorText(err)), "refresh");
        await release(db, row, c.claim_token);
        summary.flagged += 1;
      } else {
        await log(
          db,
          row,
          false,
          `Couldn't renew access, trying again in an hour: ${errorText(err)}`,
        );
        await release(db, row, c.claim_token, new Date(ctx.realNow().getTime() + REFRESH_RETRY_MS));
        summary.retrying += 1;
      }
      continue;
    }
    if (await saveTokens(run, row, c.claim_token, tokens, now)) {
      summary.refreshed += 1;
      await log(db, row, true, `Renewed access for @${row.social_accounts.handle}.`);
    }
  }
}

async function checkConnections(run: Run, summary: Summary): Promise<void> {
  const { db, ctx } = run;
  if (!run.platforms.includes("instagram") || remaining(ctx) < MIN_CALL_MS) return;
  let query = db
    .from("oauth_credentials")
    .select(CREDENTIAL_COLUMNS)
    .eq("social_accounts.platform", "instagram")
    .eq("social_accounts.status", "ready")
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(CHECK_BATCH);
  if (ctx.workspaceIds) query = query.in("workspace_id", [...ctx.workspaceIds]);
  const res = await query.overrideTypes<CredentialRow[], { merge: false }>();
  if (res.error) throw new Error(`Loading accounts to check failed: ${res.error.message}`);
  const realNow = ctx.realNow();
  const due = res.data.filter((r) =>
    connectionCheckDue(r.checked_at ? new Date(r.checked_at) : null, realNow),
  );
  const missing = [...new Set(due.map((r) => r.workspace_id))].filter(
    (id) => !run.settings.has(id),
  );
  for (const [id, s] of await loadSettings(db, missing)) run.settings.set(id, s);

  for (const row of due) {
    if (remaining(ctx) < MIN_CALL_MS) break;
    // Take the check (another tick that read the same time skips it).
    let take = db
      .from("oauth_credentials")
      .update({ checked_at: ctx.realNow().toISOString() })
      .eq("workspace_id", row.workspace_id)
      .eq("account_id", row.account_id);
    take = row.checked_at ? take.eq("checked_at", row.checked_at) : take.is("checked_at", null);
    const taken = await take.select("account_id");
    if (taken.error) throw new Error(`Recording a connection check failed: ${taken.error.message}`);
    if (taken.data.length === 0) continue;

    summary.checked += 1;
    try {
      const provider = providerOf(
        run,
        row.social_accounts.platform,
        workspaceOf(run, row.workspace_id),
      );
      await provider.getPublishingQuota(await run.reader(tokenAccount(row)));
    } catch (err) {
      if (isAuthError(err)) {
        await flag(run, row, err.userMessage, "check");
        summary.flagged += 1;
      } else if (!(err instanceof ProviderError)) {
        console.error(`refreshTokens: checking ${row.account_id}:`, err);
      }
    }
  }
}

export function createRefreshTokens(deps: RefreshDeps = {}): Step {
  return {
    name: "refreshTokens",
    async run(ctx: TickContext): Promise<StepSummary> {
      const instagram = deps.instagram === undefined ? instagramConfigFromEnv() : deps.instagram;
      const tokenKey = resolveTokenKey(deps.tokenKey);
      const run: Run = {
        db: ctx.db,
        ctx,
        instagram,
        tokenKey,
        platforms: publishPlatforms({ instagram, tokenKey }),
        reader: createTokenReader(ctx.db, tokenKey),
        fakeStore: createDbFakeStore(ctx.db),
        settings: new Map(),
      };
      const summary: Summary = {
        claimed: 0,
        refreshed: 0,
        expired: 0,
        retrying: 0,
        flagged: 0,
        released: 0,
        tokenErrors: 0,
        checked: 0,
        waiting: 0,
      };
      await refreshDue(run, summary);
      await checkConnections(run, summary);
      return { ...summary };
    },
  };
}

/** The tick's refresh step, configured from the environment. */
export const refreshTokens: Step = createRefreshTokens();
