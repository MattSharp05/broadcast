import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nowFor } from "@/lib/clock";
import { scoped, type WorkspaceTable } from "@/lib/db/scoped";
import type { Database } from "@/lib/db/types";
import { loadWorkspace } from "@/lib/db/workspace";

const COUNTED: readonly WorkspaceTable[] = [
  "brands",
  "social_accounts",
  "media_assets",
  "posts",
  "post_metrics",
  "account_metrics",
  "job_log",
];

/** What's in the Sandbox, as the signed-in user sees it (RLS applies): /dev's debug JSON. */
export async function sandboxSummary(db: SupabaseClient<Database>) {
  const workspace = await loadWorkspace(db, "sandbox");
  const ws = scoped(db, workspace.id);

  const counts = Object.fromEntries(
    await Promise.all(COUNTED.map(async (t) => [t, await ws.count(t)] as const)),
  );

  const [accounts, posts] = await Promise.all([
    db
      .from("social_accounts")
      .select("id, handle, platform, status, status_reason, slots, followers, brands(name)")
      .eq("workspace_id", workspace.id)
      .order("created_at")
      .order("handle"),
    db.from("posts").select("account_id, status").eq("workspace_id", workspace.id),
  ]);
  if (accounts.error) throw new Error(accounts.error.message);
  if (posts.error) throw new Error(posts.error.message);

  const postsByStatus: Record<string, number> = {};
  const perAccount = new Map<string, Record<string, number>>();
  for (const p of posts.data) {
    postsByStatus[p.status] = (postsByStatus[p.status] ?? 0) + 1;
    const mine = perAccount.get(p.account_id) ?? {};
    mine[p.status] = (mine[p.status] ?? 0) + 1;
    perAccount.set(p.account_id, mine);
  }

  return {
    workspace: workspace.name,
    timezone: workspace.timezone,
    clock: workspace.clockOverride ? "fixed" : "real",
    now: nowFor(workspace).toISOString(),
    counts,
    postsByStatus,
    accounts: accounts.data.map((a) => ({
      handle: a.handle,
      brand: a.brands.name,
      platform: a.platform,
      status: a.status,
      statusReason: a.status_reason,
      slots: a.slots,
      followers: a.followers,
      posts: perAccount.get(a.id) ?? {},
    })),
  };
}

export type SandboxSummary = Awaited<ReturnType<typeof sandboxSummary>>;
