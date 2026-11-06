import type { SupabaseClient } from "@supabase/supabase-js";
import { credentialContext, encryptToken } from "@/lib/crypto/tokens";
import type { ConnectionStatus } from "@/lib/domain/connect";
import type { Profile, ProviderPlatform, TokenSet } from "@/lib/providers/types";
import type { Database } from "./types";
import { WORKSPACE_IDS } from "./workspaces";

type Db = SupabaseClient<Database>;

/**
 * Connecting a social account (BC-9): the one-time OAuth state, and saving what the callback
 * learned. Every query is scoped by workspace_id.
 */

/** How long a connect attempt may take (matches oauth_states.expires_at's default). */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_RE.test(value));
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what} failed: ${error.message}`);
}

/** True when the brand exists in the workspace. */
export async function brandExists(db: Db, workspaceId: string, brandId: string): Promise<boolean> {
  if (!isUuid(brandId)) return false;
  const { data, error } = await db
    .from("brands")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", brandId)
    .maybeSingle();
  if (error) fail("Reading the brand", error);
  return data !== null;
}

/** Stores a new state for a connect attempt, and clears the workspace's expired ones. */
export async function createOAuthState(
  db: Db,
  input: {
    workspaceId: string;
    brandId: string;
    platform: ProviderPlatform;
    state: string;
    now: Date;
  },
): Promise<void> {
  const cleared = await db
    .from("oauth_states")
    .delete()
    .eq("workspace_id", input.workspaceId)
    .lt("expires_at", input.now.toISOString());
  if (cleared.error) fail("Clearing expired connect attempts", cleared.error);

  const { error } = await db.from("oauth_states").insert({
    state: input.state,
    workspace_id: input.workspaceId,
    brand_id: input.brandId,
    platform: input.platform,
    expires_at: new Date(input.now.getTime() + OAUTH_STATE_TTL_MS).toISOString(),
  });
  if (error) fail("Saving the connect attempt", error);
}

export interface ConsumedState {
  workspaceId: string;
  brandId: string;
  platform: ProviderPlatform;
  expired: boolean;
}

/**
 * Deletes the state and returns what it was for: each state works once. Null when the workspace
 * has no such state (unknown, already used, or another workspace's).
 */
export async function consumeOAuthState(
  db: Db,
  workspaceId: string,
  state: string,
  now: Date,
): Promise<ConsumedState | null> {
  const { data, error } = await db
    .from("oauth_states")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("state", state)
    .select("workspace_id, brand_id, platform, expires_at");
  if (error) fail("Reading the connect attempt", error);
  const row = data[0];
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    brandId: row.brand_id,
    platform: row.platform,
    expired: new Date(row.expires_at).getTime() <= now.getTime(),
  };
}

export interface SaveConnectionInput {
  workspaceId: string;
  /** The brand a new account joins (a reconnected account keeps its brand). */
  brandId: string;
  platform: ProviderPlatform;
  profile: Profile;
  tokens: TokenSet;
  status: ConnectionStatus;
  /** TOKEN_ENC_KEY (32 bytes). */
  key: Buffer;
  now: Date;
}

export interface SavedConnection {
  accountId: string;
  /** False when an existing account (same platform user) was updated. */
  created: boolean;
}

/**
 * Creates or updates the social account for the connected platform user, and stores its token
 * encrypted (ADR 0004). Needs the service-role client: oauth_credentials and fake_accounts have
 * no browser access.
 *
 * - One account per (workspace, platform, platform user): reconnecting updates it, never adds a
 *   second one.
 * - The status only changes once the token is stored: a new account starts as not_connected, so
 *   a failure halfway never leaves a "ready" account without a token.
 */
export async function saveConnection(
  admin: Db,
  input: SaveConnectionInput,
): Promise<SavedConnection> {
  const ws = input.workspaceId;
  const platformUserId = input.profile.platformUserId;
  if (input.platform === "fake" && ws !== WORKSPACE_IDS.sandbox) {
    throw new Error("Fake accounts belong in the Sandbox workspace.");
  }

  const findExisting = async () => {
    const { data, error } = await admin
      .from("social_accounts")
      .select("id")
      .eq("workspace_id", ws)
      .eq("platform", input.platform)
      .eq("platform_user_id", platformUserId)
      .maybeSingle();
    if (error) fail("Looking up the account", error);
    return data?.id ?? null;
  };

  let accountId = await findExisting();
  let created = false;
  if (!accountId) {
    const inserted = await admin
      .from("social_accounts")
      .insert({
        workspace_id: ws,
        brand_id: input.brandId,
        platform: input.platform,
        platform_user_id: platformUserId,
        handle: input.profile.handle,
        profile_url: input.profile.profileUrl,
        followers: input.profile.followers,
        status: "not_connected",
      })
      .select("id")
      .single();
    if (inserted.error) {
      // Another request connected the same user a moment ago (unique index): use that account.
      if (inserted.error.code !== "23505") fail("Creating the account", inserted.error);
      accountId = await findExisting();
      if (!accountId) fail("Creating the account", inserted.error);
    } else {
      accountId = inserted.data.id;
      created = true;
    }
  }

  const creds = await admin.from("oauth_credentials").upsert(
    {
      account_id: accountId,
      workspace_id: ws,
      access_token_enc: encryptToken(
        input.tokens.accessToken,
        input.key,
        credentialContext(accountId),
      ),
      refresh_token_enc: null,
      expires_at: input.tokens.expiresAt.toISOString(),
      scopes: [...input.tokens.scopes],
      last_refreshed_at: input.now.toISOString(),
    },
    { onConflict: "account_id" },
  );
  if (creds.error) fail("Storing the token", creds.error);

  if (input.platform === "fake") {
    // The fake provider's per-account settings (defaults: everything works).
    const fake = await admin
      .from("fake_accounts")
      .upsert(
        { account_id: accountId, workspace_id: ws },
        { onConflict: "account_id", ignoreDuplicates: true },
      );
    if (fake.error) fail("Setting up the Sandbox account", fake.error);
  }

  const updated = await admin
    .from("social_accounts")
    .update({
      handle: input.profile.handle,
      profile_url: input.profile.profileUrl,
      followers: input.profile.followers,
      status: input.status.status,
      status_reason: input.status.reason,
    })
    .eq("workspace_id", ws)
    .eq("id", accountId);
  if (updated.error) fail("Updating the account", updated.error);

  const log = await admin.from("job_log").insert({
    workspace_id: ws,
    kind: "connect",
    account_id: accountId,
    ok: input.status.status === "ready",
    message:
      input.status.status === "ready"
        ? `Connected @${input.profile.handle}.`
        : `Connected @${input.profile.handle}; needs attention: ${input.status.reason ?? ""}`,
    at: input.now.toISOString(),
  });
  if (log.error) fail("Writing the activity log", log.error);

  return { accountId, created };
}
