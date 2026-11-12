import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PerformanceData, PostPerformance } from "@/lib/domain/performance";
import type { Database } from "./types";

/**
 * What the Workflow tab's performance line adds up (src/lib/domain/performance.ts): every
 * published post with its latest taken stat, and daily followers for the last 61 days. Scoped by
 * workspace_id.
 */
export async function loadPerformance(
  db: SupabaseClient<Database>,
  workspaceId: string,
  now: Date,
): Promise<PerformanceData> {
  const since = new Date(now.getTime() - 61 * 86_400_000).toISOString().slice(0, 10);
  const [posts, metrics, followers, accounts] = await Promise.all([
    db
      .from("posts")
      .select("id, account_id, published_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "published"),
    db
      .from("post_metrics")
      .select("post_id, views, reach, likes, comments, shares, saves, taken_at, missed")
      .eq("workspace_id", workspaceId)
      .not("taken_at", "is", null)
      .eq("missed", false)
      .order("taken_at", { ascending: false }),
    db
      .from("account_metrics")
      .select("account_id, day, followers")
      .eq("workspace_id", workspaceId)
      .gte("day", since),
    db.from("social_accounts").select("id, followers").eq("workspace_id", workspaceId),
  ]);
  for (const r of [posts, metrics, followers, accounts]) {
    if (r.error) throw new Error(`Loading the performance totals failed: ${r.error.message}`);
  }
  const latest = new Map<string, NonNullable<typeof metrics.data>[number]>();
  for (const m of metrics.data ?? []) if (!latest.has(m.post_id)) latest.set(m.post_id, m);
  const out: PostPerformance[] = [];
  for (const p of posts.data ?? []) {
    if (!p.published_at) continue;
    const m = latest.get(p.id);
    out.push({
      accountId: p.account_id,
      publishedAt: p.published_at,
      views: m?.views ?? null,
      reach: m?.reach ?? null,
      likes: m?.likes ?? null,
      comments: m?.comments ?? null,
      shares: m?.shares ?? null,
      saves: m?.saves ?? null,
    });
  }
  return {
    posts: out,
    followers: (followers.data ?? []).map((f) => ({
      accountId: f.account_id,
      day: f.day,
      followers: f.followers,
    })),
    current: Object.fromEntries((accounts.data ?? []).map((a) => [a.id, a.followers])),
  };
}
