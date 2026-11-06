import { openSlots, type PlannerPost, type PostStatus, type PostTiming } from "@/lib/domain/queue";
import { sameLocalDay } from "@/lib/domain/format";

/**
 * The Workflow canvas model (docs/DESIGN.md → Layout → Workflow canvas): per account, what sits
 * above the now line (upcoming, next nearest) and below it (posted, newest first). Pure: the
 * loader (src/lib/db/canvas.ts) reads rows and calls `buildCanvas`.
 */

/** Upcoming rows per column (posts and open slots together); the rest is "N more in backlog". */
export const UPCOMING_ROWS = 4;
/** Posted cards cover this many days back from now. */
export const POSTED_DAYS = 7;

const DAY_MS = 86_400_000;

export type AccountState = "ready" | "needs_attention" | "not_connected";

export interface CanvasAccountInput {
  id: string;
  handle: string;
  brand: string;
  platform: string;
  tags: readonly string[];
  slots: readonly string[];
  status: AccountState;
  statusReason: string | null;
  followers: number | null;
}

export interface CanvasPostInput {
  id: string;
  accountId: string;
  caption: string;
  timing: PostTiming;
  queuePosition: number | null;
  status: PostStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  lastError: string | null;
  durationS: number | null;
  /** A displayable thumbnail URL (already signed), or null for the placeholder. */
  thumbnailUrl: string | null;
}

export interface PostMetricsInput {
  views: number | null;
  likes: number | null;
  comments: number | null;
}

export interface CanvasInput {
  accounts: readonly CanvasAccountInput[];
  posts: readonly CanvasPostInput[];
  /** The latest stats per post id. */
  metrics: ReadonlyMap<string, PostMetricsInput>;
  now: Date;
  timezone: string;
}

interface CardBase {
  id: string;
  title: string;
  durationS: number | null;
  thumbnailUrl: string | null;
}

export type UpcomingCard =
  | (CardBase & {
      kind: "scheduled" | "pinned" | "paused" | "publishing";
      /** null: the account has no slots, so the post waits without a time. */
      at: Date | null;
    })
  | { kind: "open"; id: string; at: Date };

export type PostedCard =
  | (CardBase & {
      kind: "posted";
      at: Date;
      /** The latest refresh's numbers: 0 before the first; null when not reported ("—"). */
      views: number | null;
      likes: number | null;
      comments: number | null;
    })
  | (CardBase & { kind: "failed"; at: Date; reason: string });

/** The chip on the now line: the countdown (`at` may be past: due now), or why there is none. */
export type NextUp = { kind: "next"; at: Date } | { kind: "paused" } | { kind: "none" };

export interface CanvasColumn {
  id: string;
  handle: string;
  brand: string;
  platform: string;
  tags: readonly string[];
  status: AccountState;
  statusReason: string | null;
  followers: number | null;
  /** Videos waiting to be posted (every upcoming post). */
  backlog: number;
  profileUrl: string;
  /** 1–6: which --avatar-n colour the account uses. */
  avatar: number;
  /** Nearest the line first. */
  upcoming: UpcomingCard[];
  /** Upcoming posts that didn't fit in UPCOMING_ROWS. */
  moreInBacklog: number;
  /** Newest first, last POSTED_DAYS days. */
  posted: PostedCard[];
  next: NextUp;
}

export interface CanvasStats {
  scheduled: number;
  /** The earliest scheduled post across all accounts. */
  nextAt: Date | null;
  postedToday: number;
  failed: number;
}

export interface CanvasModel {
  columns: CanvasColumn[];
  stats: CanvasStats;
}

/** Post statuses that wait in an account's backlog (the upcoming lane; the Accounts tab's Backlog). */
export const UPCOMING_STATUSES: ReadonlySet<PostStatus> = new Set([
  "queued",
  "paused",
  "publishing",
]);

/** The account's public profile. The fake provider mimics Instagram, so it links there too. */
export function profileUrl(platform: string, handle: string): string {
  const h = encodeURIComponent(handle.replace(/^@/, ""));
  if (platform === "tiktok") return `https://www.tiktok.com/@${h}`;
  return `https://www.instagram.com/${h}/`;
}

/** A stable avatar colour (1–6) from the account id. */
export function avatarIndex(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 6) + 1;
}

/** Two letters from the handle: "codingjourney" → "CO". */
export function initials(handle: string): string {
  return (handle.replace(/[^a-z]/gi, "").slice(0, 2) || "?").toUpperCase();
}

/** One short line for a failed card; the full error is in the drawer (BC-15). */
export function failureSummary(lastError: string | null): string {
  const e = (lastError ?? "").trim();
  if (!e) return "Publishing failed. Open to retry.";
  if (/aspect ratio|9:16|1080 ?× ?1350/i.test(e)) return "Wrong aspect ratio. Open to fix.";
  if (/quota|limit/i.test(e)) return "Daily post limit reached.";
  if (/token|access|expired|reconnect/i.test(e)) return "Access expired. Reconnect to retry.";
  const first = /^(.+?[.!?])(\s|$)/.exec(e)?.[1] ?? e;
  return first;
}

function postTime(p: CanvasPostInput): Date | null {
  return p.publishedAt ?? p.scheduledAt;
}

function upcomingCard(p: CanvasPostInput): UpcomingCard {
  const base = {
    id: p.id,
    title: p.caption,
    durationS: p.durationS,
    thumbnailUrl: p.thumbnailUrl,
    at: p.scheduledAt,
  };
  if (p.status === "paused") return { ...base, kind: "paused" };
  if (p.status === "publishing") return { ...base, kind: "publishing" };
  return { ...base, kind: p.timing === "pinned" ? "pinned" : "scheduled" };
}

function byTimeAsc(a: { at: Date | null }, b: { at: Date | null }): number {
  return (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity);
}

function buildColumn(
  account: CanvasAccountInput,
  posts: readonly CanvasPostInput[],
  input: CanvasInput,
): CanvasColumn {
  const { now, timezone, metrics } = input;

  const waiting = posts.filter((p) => UPCOMING_STATUSES.has(p.status));
  const cards: UpcomingCard[] = waiting.map(upcomingCard).sort(byTimeAsc);

  // Open slots: the free slots after the backlog (BC-4's planner), up to the row limit.
  const planner: PlannerPost[] = waiting.map((p) => ({
    id: p.id,
    timing: p.timing,
    queuePosition: p.queuePosition,
    scheduledAt: p.scheduledAt,
    status: p.status,
  }));
  const open: UpcomingCard[] =
    account.slots.length > 0
      ? openSlots({
          slots: account.slots,
          timezone,
          now,
          posts: planner,
          count: UPCOMING_ROWS,
        }).map((at) => ({ kind: "open", id: `open-${account.id}-${at.toISOString()}`, at }))
      : [];
  const upcoming = [...cards, ...open].sort(byTimeAsc).slice(0, UPCOMING_ROWS);
  const shownPosts = upcoming.filter((c) => c.kind !== "open").length;

  const since = now.getTime() - POSTED_DAYS * DAY_MS;
  const posted: PostedCard[] = posts
    .filter((p) => p.status === "published" || p.status === "failed")
    .map((p) => ({ p, at: postTime(p) }))
    .filter((x): x is { p: CanvasPostInput; at: Date } => {
      const t = x.at?.getTime();
      return t !== undefined && t >= since && t <= now.getTime();
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map(({ p, at }): PostedCard => {
      const base = {
        id: p.id,
        title: p.caption,
        durationS: p.durationS,
        thumbnailUrl: p.thumbnailUrl,
        at,
      };
      if (p.status === "failed")
        return { ...base, kind: "failed", reason: failureSummary(p.lastError) };
      const m = metrics.get(p.id);
      return {
        ...base,
        kind: "posted",
        views: m ? m.views : 0,
        likes: m ? m.likes : 0,
        comments: m ? m.comments : 0,
      };
    });

  // The earliest post going out; one whose time has passed is due now (the scheduler picks it up).
  const nextPost = cards.find(
    (c) =>
      (c.kind === "scheduled" || c.kind === "pinned" || c.kind === "publishing") && c.at !== null,
  );
  let next: NextUp;
  if (
    account.status === "needs_attention" ||
    (!nextPost && cards.some((c) => c.kind === "paused"))
  ) {
    next = { kind: "paused" };
  } else if (nextPost?.at) {
    next = { kind: "next", at: nextPost.at };
  } else {
    next = { kind: "none" };
  }

  return {
    id: account.id,
    handle: account.handle,
    brand: account.brand,
    platform: account.platform,
    tags: account.tags,
    status: account.status,
    statusReason: account.statusReason,
    followers: account.followers,
    backlog: waiting.length,
    profileUrl: profileUrl(account.platform, account.handle),
    avatar: avatarIndex(account.id),
    upcoming,
    moreInBacklog: waiting.length - shownPosts,
    posted,
    next,
  };
}

/** The canvas for every account (in the given order) plus the top bar's stats. */
export function buildCanvas(input: CanvasInput): CanvasModel {
  const byAccount = new Map<string, CanvasPostInput[]>();
  for (const p of input.posts) {
    const list = byAccount.get(p.accountId);
    if (list) list.push(p);
    else byAccount.set(p.accountId, [p]);
  }
  const columns = input.accounts.map((a) => buildColumn(a, byAccount.get(a.id) ?? [], input));
  return { columns, stats: canvasStats(input) };
}

/** "N scheduled | Next post in … | N posted today | N failed" across the workspace. */
export function canvasStats(input: Pick<CanvasInput, "posts" | "now" | "timezone">): CanvasStats {
  const { posts, now, timezone } = input;
  const since = now.getTime() - POSTED_DAYS * DAY_MS;
  const scheduled = posts.filter((p) => p.status === "queued" && p.scheduledAt);
  const future = scheduled
    .map((p) => p.scheduledAt)
    .filter((t): t is Date => t !== null && t > now)
    .sort((a, b) => a.getTime() - b.getTime());
  return {
    scheduled: scheduled.length,
    nextAt: future[0] ?? null,
    postedToday: posts.filter(
      (p) =>
        p.status === "published" &&
        p.publishedAt !== null &&
        p.publishedAt <= now &&
        sameLocalDay(p.publishedAt, now, timezone),
    ).length,
    // The failed cards on the canvas (Posted shows the last POSTED_DAYS days).
    failed: posts.filter((p) => {
      const t = postTime(p)?.getTime();
      return p.status === "failed" && t !== undefined && t >= since && t <= now.getTime();
    }).length,
  };
}
