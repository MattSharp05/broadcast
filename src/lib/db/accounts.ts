import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRow, BrandRef } from "@/lib/domain/accounts";
import { UPCOMING_STATUSES, avatarIndex, profileUrl } from "@/lib/domain/canvas";
import { cleanSlots } from "@/lib/domain/add-account";
import { replanAccount, type QueueContext } from "./posts";
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

export async function loadAccounts(db: Db, workspaceId: string): Promise<AccountsData> {
  const [brands, accounts] = await Promise.all([
    db.from("brands").select("id, name").eq("workspace_id", workspaceId).order("name"),
    db
      .from("social_accounts")
      .select(
        "id, handle, platform, brand_id, description, tags, slots, status, status_reason, followers, brands(name), backlog:posts(count)",
      )
      .eq("workspace_id", workspaceId)
      // Counted in the database: the embedded count only sees waiting posts.
      .in("posts.status", [...UPCOMING_STATUSES])
      .order("handle"),
  ]);
  if (brands.error) throw new Error(`Loading brands failed: ${brands.error.message}`);
  if (accounts.error) throw new Error(`Loading accounts failed: ${accounts.error.message}`);

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
      backlog: a.backlog[0]?.count ?? 0,
      profileUrl: profileUrl(a.platform, a.handle),
      avatar: avatarIndex(a.id),
    })),
  };
}

/** Thrown when the row isn't in the workspace (or RLS hides it). */
export class NotFoundError extends Error {}

/** Thrown when another brand of the workspace already has the name (ignoring case). */
export class DuplicateBrandError extends Error {
  constructor(name: string) {
    super(`There is already a brand called ${name}.`);
  }
}

async function assertNameFree(db: Db, workspaceId: string, name: string, except?: string) {
  const res = await db.from("brands").select("id, name").eq("workspace_id", workspaceId);
  if (res.error) throw new Error(`Reading brands failed: ${res.error.message}`);
  const lower = name.toLowerCase();
  const clash = res.data.find((b) => b.id !== except && b.name.toLowerCase() === lower);
  if (clash) throw new DuplicateBrandError(clash.name);
}

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

/**
 * Replaces the account's daily posting slots (cleaned: valid, unique, earliest first) and re-times
 * its queue (BC-18). Returns the slots as saved.
 */
export async function saveAccountSlots(
  db: Db,
  ctx: QueueContext,
  accountId: string,
  slots: readonly string[],
): Promise<string[]> {
  const clean = cleanSlots(slots);
  await updateAccount(db, ctx.workspaceId, accountId, { slots: clean });
  await replanAccount(db, ctx, accountId);
  return clean;
}

export async function createBrand(db: Db, workspaceId: string, name: string): Promise<BrandRef> {
  await assertNameFree(db, workspaceId, name);
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
  await assertNameFree(db, workspaceId, name, brandId);
  const res = await db
    .from("brands")
    .update({ name })
    .eq("workspace_id", workspaceId)
    .eq("id", brandId)
    .select("id");
  if (res.error) throw new Error(`Renaming the brand failed: ${res.error.message}`);
  if (res.data.length !== 1) throw new NotFoundError("That brand no longer exists.");
}
