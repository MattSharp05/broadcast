import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRow, BrandRef } from "@/lib/domain/accounts";
import { avatarIndex, profileUrl } from "@/lib/domain/canvas";
import type { Database } from "./types";

/**
 * The Accounts tab's reads and inline edits. Every function takes the caller's client (the
 * signed-in user's, so RLS applies) and the workspace id, and scopes each query by it.
 */

type Db = SupabaseClient<Database>;

export interface AccountsData {
  accounts: AccountRow[];
  /** Every brand of the workspace, including ones without accounts yet. */
  brands: BrandRef[];
}

/** Post statuses that count as "in the backlog" (same as the canvas's upcoming lane). */
const BACKLOG_STATUSES = ["queued", "paused", "publishing"] as const;

export async function loadAccounts(db: Db, workspaceId: string): Promise<AccountsData> {
  const [brands, accounts, backlog] = await Promise.all([
    db.from("brands").select("id, name").eq("workspace_id", workspaceId).order("name"),
    db
      .from("social_accounts")
      .select(
        "id, handle, platform, brand_id, description, tags, slots, status, status_reason, followers, brands(name)",
      )
      .eq("workspace_id", workspaceId)
      .order("handle"),
    db
      .from("posts")
      .select("account_id")
      .eq("workspace_id", workspaceId)
      .in("status", [...BACKLOG_STATUSES]),
  ]);
  if (brands.error) throw new Error(`Loading brands failed: ${brands.error.message}`);
  if (accounts.error) throw new Error(`Loading accounts failed: ${accounts.error.message}`);
  if (backlog.error) throw new Error(`Loading backlogs failed: ${backlog.error.message}`);

  const waiting = new Map<string, number>();
  for (const p of backlog.data) waiting.set(p.account_id, (waiting.get(p.account_id) ?? 0) + 1);

  return {
    brands: brands.data,
    accounts: accounts.data.map((a) => ({
      id: a.id,
      handle: a.handle,
      platform: a.platform,
      brandId: a.brand_id,
      brand: a.brands.name,
      tags: a.tags,
      description: a.description,
      status: a.status,
      statusReason: a.status_reason,
      followers: a.followers,
      slotsPerDay: a.slots.length,
      backlog: waiting.get(a.id) ?? 0,
      profileUrl: profileUrl(a.platform, a.handle),
      avatar: avatarIndex(a.id),
    })),
  };
}

/** Thrown when the row isn't in the workspace (or RLS hides it). */
export class NotFoundError extends Error {}

async function updateAccount(
  db: Db,
  workspaceId: string,
  accountId: string,
  patch: Database["public"]["Tables"]["social_accounts"]["Update"],
): Promise<void> {
  const res = await db
    .from("social_accounts")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", accountId)
    .select("id");
  if (res.error) throw new Error(`Saving the account failed: ${res.error.message}`);
  if (res.data.length !== 1) throw new NotFoundError("That account no longer exists.");
}

/** Replaces the account's tags (already cleaned: see cleanTags). */
export function saveAccountTags(
  db: Db,
  workspaceId: string,
  accountId: string,
  tags: readonly string[],
): Promise<void> {
  return updateAccount(db, workspaceId, accountId, { tags: [...tags] });
}

/** Replaces the account's description (already cleaned: see cleanDescription). */
export function saveAccountDescription(
  db: Db,
  workspaceId: string,
  accountId: string,
  description: string,
): Promise<void> {
  return updateAccount(db, workspaceId, accountId, { description });
}

export async function createBrand(db: Db, workspaceId: string, name: string): Promise<BrandRef> {
  const res = await db
    .from("brands")
    .insert({ workspace_id: workspaceId, name })
    .select("id, name")
    .single();
  if (res.error) throw new Error(`Creating the brand failed: ${res.error.message}`);
  return res.data;
}

export async function renameBrand(
  db: Db,
  workspaceId: string,
  brandId: string,
  name: string,
): Promise<void> {
  const res = await db
    .from("brands")
    .update({ name })
    .eq("workspace_id", workspaceId)
    .eq("id", brandId)
    .select("id");
  if (res.error) throw new Error(`Renaming the brand failed: ${res.error.message}`);
  if (res.data.length !== 1) throw new NotFoundError("That brand no longer exists.");
}
