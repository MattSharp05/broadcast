import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UPCOMING_STATUSES } from "@/lib/domain/canvas";
import {
  buildAccountDetails,
  followerSince,
  type AccountDetail,
  type CredentialInput,
} from "@/lib/domain/details";
import { createAdminSupabase } from "./admin";
import type { Database } from "./types";

type Db = SupabaseClient<Database>;

const DAY_MS = 86_400_000;

function fail(what: string, error: { message: string }): never {
  throw new Error(`Loading account details failed at ${what}: ${error.message}`);
}

/**
 * Token expiry and granted scopes per account. oauth_credentials is service-role only (ADR 0004),
 * so this reads with the admin client and returns only those two columns: never a token. With no
 * service-role key (or on any error) the drawer just shows no token details.
 */
async function loadCredentials(workspaceId: string): Promise<CredentialInput[]> {
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("oauth_credentials")
      .select("account_id, expires_at, scopes")
      .eq("workspace_id", workspaceId);
    if (error) return [];
    return data.map((c) => ({
      accountId: c.account_id,
      expiresAt: c.expires_at ? new Date(c.expires_at) : null,
      scopes: c.scopes,
    }));
  } catch {
    return [];
  }
}

/**
 * What the account previews and drawers show for every account in the workspace (BC-15):
 * profile, slots, description, followers over the last 30 days, last week's views and posts,
 * posts used in the last 24 hours and the connection. Read as the signed-in user (RLS applies),
 * except the token expiry (see loadCredentials).
 */
export async function loadAccountDetails(
  db: Db,
  workspaceId: string,
  now: Date,
  timezone: string,
): Promise<AccountDetail[]> {
  const week = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const upcoming = [...UPCOMING_STATUSES].join(",");

  const [accounts, posts, followers, credentials] = await Promise.all([
    db
      .from("social_accounts")
      .select(
        "id, handle, platform, status, status_reason, followers, description, vault_url, slots, brands(name)",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at")
      .order("handle"),
    db
      .from("posts")
      .select("id, account_id, status, published_at")
      .eq("workspace_id", workspaceId)
      .or(`status.in.(${upcoming}),published_at.gte.${week}`),
    db
      .from("account_metrics")
      .select("account_id, day, followers")
      .eq("workspace_id", workspaceId)
      .gte("day", followerSince(now, timezone))
      .order("day"),
    loadCredentials(workspaceId),
  ]);
  if (accounts.error) fail("accounts", accounts.error);
  if (posts.error) fail("posts", posts.error);
  if (followers.error) fail("followers", followers.error);

  const publishedIds = posts.data.filter((p) => p.status === "published").map((p) => p.id);
  const views = new Map<string, number | null>();
  if (publishedIds.length > 0) {
    const res = await db
      .from("post_metrics")
      .select("post_id, views, taken_at")
      .eq("workspace_id", workspaceId)
      .in("post_id", publishedIds)
      .not("taken_at", "is", null)
      .order("taken_at", { ascending: false });
    if (res.error) fail("stats", res.error);
    for (const m of res.data) if (!views.has(m.post_id)) views.set(m.post_id, m.views);
  }

  return buildAccountDetails({
    accounts: accounts.data.map((a) => ({
      id: a.id,
      handle: a.handle,
      brand: a.brands.name,
      platform: a.platform,
      status: a.status,
      statusReason: a.status_reason,
      followers: a.followers,
      description: a.description,
      vaultUrl: a.vault_url,
      slots: a.slots,
    })),
    posts: posts.data.map((p) => ({
      accountId: p.account_id,
      status: p.status,
      publishedAt: p.published_at ? new Date(p.published_at) : null,
      views: views.get(p.id) ?? null,
    })),
    followers: followers.data.map((f) => ({
      accountId: f.account_id,
      day: f.day,
      followers: f.followers,
    })),
    credentials,
    now,
    timezone,
  });
}
