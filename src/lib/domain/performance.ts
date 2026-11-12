/**
 * The Workflow tab's performance line (pure): totals of the engagement numbers already collected
 * (post_metrics) and followers (account_metrics), for a period, over the accounts the canvas shows.
 * Each post counts once, with its latest taken stat (never a sum across the refresh offsets).
 */

export type Period = "7d" | "30d" | "all";

export const PERIODS: readonly { value: Period; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

export const METRICS = ["views", "reach", "likes", "comments", "shares", "saves"] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_LABELS: Record<Metric | "followers", string> = {
  views: "views",
  reach: "reach",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  saves: "saves",
  followers: "followers",
};

const DAY_MS = 86_400_000;

export interface PostPerformance {
  accountId: string;
  publishedAt: string;
  /** The post's latest taken stat (null: not reported). */
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

export interface FollowerPoint {
  accountId: string;
  /** YYYY-MM-DD (workspace-local day). */
  day: string;
  followers: number;
}

export interface PerformanceData {
  posts: PostPerformance[];
  followers: FollowerPoint[];
  /** Each account's current follower count (social_accounts.followers), as a fallback. */
  current: Record<string, number | null>;
}

export interface Total {
  /** null: no number reported for this period ("—"). */
  value: number | null;
  /** Change vs the period before, as a fraction (0.12 = +12%); null when it can't be told. */
  change: number | null;
}

export type Totals = Record<Metric | "followers", Total>;

function days(period: Period): number | null {
  return period === "7d" ? 7 : period === "30d" ? 30 : null;
}

function sum(posts: readonly PostPerformance[], m: Metric): number | null {
  let total: number | null = null;
  for (const p of posts) {
    const v = p[m];
    if (v !== null) total = (total ?? 0) + v;
  }
  return total;
}

function change(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev <= 0) return null;
  return (cur - prev) / prev;
}

/** Each account's latest follower count on or before `day` (YYYY-MM-DD), else null. */
function followersOn(
  points: readonly FollowerPoint[],
  accountId: string,
  day: string,
): number | null {
  let best: FollowerPoint | null = null;
  for (const p of points) {
    if (p.accountId !== accountId || p.day > day) continue;
    if (!best || p.day > best.day) best = p;
  }
  return best?.followers ?? null;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function aggregatePerformance(input: {
  data: PerformanceData;
  /** The accounts the canvas shows (after the Tag filter). */
  accountIds: readonly string[];
  period: Period;
  now: Date;
}): Totals {
  const ids = new Set(input.accountIds);
  const n = days(input.period);
  const nowMs = input.now.getTime();
  const posts = input.data.posts.filter((p) => ids.has(p.accountId));
  const inWindow = (p: PostPerformance, from: number, to: number) => {
    const t = new Date(p.publishedAt).getTime();
    return t > from && t <= to;
  };
  const current =
    n === null
      ? posts.filter((p) => new Date(p.publishedAt).getTime() <= nowMs)
      : posts.filter((p) => inWindow(p, nowMs - n * DAY_MS, nowMs));
  const previous =
    n === null
      ? null
      : posts.filter((p) => inWindow(p, nowMs - 2 * n * DAY_MS, nowMs - n * DAY_MS));

  const out = {} as Totals;
  for (const m of METRICS) {
    const value = sum(current, m);
    out[m] = { value, change: previous ? change(value, sum(previous, m)) : null };
  }

  // Followers: today's total over the shown accounts, vs the total at the start of the period.
  let nowTotal: number | null = null;
  let thenTotal: number | null = null;
  let thenComplete = n !== null;
  const today = isoDay(input.now);
  const startDay = n === null ? null : isoDay(new Date(nowMs - n * DAY_MS));
  for (const id of ids) {
    const latest = followersOn(input.data.followers, id, today) ?? input.data.current[id] ?? null;
    if (latest !== null) nowTotal = (nowTotal ?? 0) + latest;
    if (startDay) {
      const then = followersOn(input.data.followers, id, startDay);
      if (then === null) thenComplete = false;
      else thenTotal = (thenTotal ?? 0) + then;
    }
  }
  out.followers = { value: nowTotal, change: thenComplete ? change(nowTotal, thenTotal) : null };
  return out;
}

/** "+12%", "−4%", "0%"; null when there's nothing to compare. */
export function changeLabel(c: number | null): string | null {
  if (c === null || !Number.isFinite(c)) return null;
  const pct = Math.round(c * 100);
  if (pct === 0) return "0%";
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}
