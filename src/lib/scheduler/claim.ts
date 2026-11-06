import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

type Db = SupabaseClient<Database>;
type Platform = Database["public"]["Enums"]["platform"];

/** The kinds of work a tick claims. Stats (BC-21) and token refresh (BC-19) add theirs. */
export type WorkKind = "publish";

export interface Claim {
  postId: string;
  workspaceId: string;
  /** Proves this tick still holds the row when it writes the result. */
  token: string;
}

export interface ClaimOptions {
  /** Platforms whose work this step can do. */
  platforms: readonly Platform[];
  /** Only these workspaces (the /dev button ticks the Sandbox only); all when absent. */
  workspaceIds?: readonly string[];
  /** How long the claim holds before another tick may take the row (default 120 s). */
  leaseSeconds?: number;
}

/**
 * Claims up to `limit` rows of due work: `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)
 * RETURNING` in the database (`claim_work`, migration 0003), so two overlapping ticks never take
 * the same row. Needs the service-role client.
 */
export async function claim(
  db: Db,
  kind: WorkKind,
  limit: number,
  options: ClaimOptions,
): Promise<Claim[]> {
  const { data, error } = await db.rpc("claim_work", {
    p_kind: kind,
    p_limit: limit,
    p_platforms: [...options.platforms],
    ...(options.workspaceIds ? { p_workspace_ids: [...options.workspaceIds] } : {}),
    ...(options.leaseSeconds ? { p_lease_seconds: options.leaseSeconds } : {}),
  });
  if (error) throw new Error(`Claiming ${kind} work failed: ${error.message}`);
  return data.map((row) => ({
    postId: row.post_id,
    workspaceId: row.workspace_id,
    token: row.claim_token,
  }));
}

/** Gives a claimed post back untouched (the tick ran out of time before reaching it). */
export async function release(db: Db, c: Claim): Promise<void> {
  const { error } = await db
    .from("posts")
    .update({ claimed_until: null, claim_token: null })
    .eq("workspace_id", c.workspaceId)
    .eq("id", c.postId)
    .eq("claim_token", c.token);
  if (error) throw new Error(`Releasing a claim failed: ${error.message}`);
}
