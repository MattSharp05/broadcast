import { UPCOMING_STATUSES, avatarIndex, profileUrl, type AccountState } from "@/lib/domain/canvas";
import { REQUIRED_PERMISSIONS, type ConnectPlatform, type Permission } from "@/lib/domain/connect";
import type { PostStatus } from "@/lib/domain/queue";
import { addDays, toLocalDate } from "@/lib/domain/time";

/**
 * What the hover previews and detail drawers show (BC-15): a post's stats and refresh history,
 * an account's followers, recent activity and connection. Pure: the loaders in src/lib/db read
 * the rows and call these builders.
 */

/** Stats refreshes after posting (the stat_offset enum), in order. */
export const STAT_OFFSETS = ["1h", "6h", "24h", "48h", "7d"] as const;
export type StatOffset = (typeof STAT_OFFSETS)[number];

export const STAT_OFFSET_LABELS: Record<StatOffset, string> = {
  "1h": "1 h",
  "6h": "6 h",
  "24h": "24 h",
  "48h": "48 h",
  "7d": "7 days",
};

/** Instagram's publishing limit per account in a rolling 24 hours. */
export const DAILY_POST_LIMIT = 100;
/** The followers chart covers this many days, ending today. */
export const FOLLOWER_DAYS = 30;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// ── Posts ──────────────────────────────────────────────────────────────────────────────────────

export interface PostMetricRow {
  postId: string;
  offset: StatOffset;
  takenAt: Date | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  /** Came due while the scheduler was down and was never taken (no numbers). */
  missed: boolean;
}

/** A refresh's numbers; null: the platform doesn't report that metric for this post ("—"). */
export interface PostStats {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

export interface StatSnapshot {
  offset: StatOffset;
  /** null: this refresh hasn't happened yet, was missed, or reported no views. */
  views: number | null;
  /** The refresh came due while the scheduler was down and was skipped. */
  missed: boolean;
  /** The refresh happened (its views may still be null: not reported). */
  taken: boolean;
}

export interface PostDetail {
  id: string;
  accountId: string;
  /** The full caption (cards show it as the title). */
  caption: string;
  timing: "queue" | "pinned";
  /** The full error of a failed post (cards show a one-line summary). */
  error: string | null;
  attempts: number;
  permalink: string | null;
  /** The latest refresh's numbers; null before the first one. */
  stats: PostStats | null;
  refreshedAt: Date | null;
  /** One entry per refresh, in order. */
  snapshots: StatSnapshot[];
  /** The next refresh still to come, or null when all five are done. */
  nextRefresh: StatOffset | null;
}

export interface PostDetailInput {
  id: string;
  accountId: string;
  caption: string;
  timing: "queue" | "pinned";
  status: PostStatus;
  lastError: string | null;
  attempts: number;
  permalink: string | null;
}

function statsOf(row: PostMetricRow): PostStats {
  return {
    views: row.views,
    reach: row.reach,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
  };
}

/** A post's drawer data from its row and its stats rows (any order). */
export function postDetail(post: PostDetailInput, rows: readonly PostMetricRow[]): PostDetail {
  const taken = new Map<StatOffset, PostMetricRow>();
  const missed = new Set<StatOffset>();
  for (const r of rows) {
    if (r.postId !== post.id || !r.takenAt) continue;
    if (r.missed) missed.add(r.offset);
    else taken.set(r.offset, r);
  }
  const latest = [...taken.values()].sort(
    (a, b) => (b.takenAt?.getTime() ?? 0) - (a.takenAt?.getTime() ?? 0),
  )[0];
  const published = post.status === "published";
  return {
    id: post.id,
    accountId: post.accountId,
    caption: post.caption,
    timing: post.timing,
    error: post.status === "failed" ? post.lastError : null,
    attempts: post.attempts,
    permalink: post.permalink,
    stats: latest ? statsOf(latest) : null,
    refreshedAt: latest?.takenAt ?? null,
    snapshots: STAT_OFFSETS.map((offset) => ({
      offset,
      views: taken.get(offset)?.views ?? null,
      missed: missed.has(offset),
      taken: taken.has(offset),
    })),
    nextRefresh: published
      ? (STAT_OFFSETS.find((o) => !taken.has(o) && !missed.has(o)) ?? null)
      : null,
  };
}

/** Drawer data for every post, keyed by id. */
export function buildPostDetails(
  posts: readonly PostDetailInput[],
  rows: readonly PostMetricRow[],
): Record<string, PostDetail> {
  const byPost = new Map<string, PostMetricRow[]>();
  for (const r of rows) {
    const list = byPost.get(r.postId);
    if (list) list.push(r);
    else byPost.set(r.postId, [r]);
  }
  const out: Record<string, PostDetail> = {};
  for (const p of posts) out[p.id] = postDetail(p, byPost.get(p.id) ?? []);
  return out;
}

// ── Accounts ───────────────────────────────────────────────────────────────────────────────────

export interface FollowerPoint {
  /** "YYYY-MM-DD", the workspace's calendar day. */
  day: string;
  followers: number;
}

export interface AccountConnection {
  /** When the access token expires (null: it doesn't say). */
  expiresAt: Date | null;
  /** The permissions granted, in the user's words, in REQUIRED_PERMISSIONS order. */
  permissions: Permission["key"][];
}

export interface AccountDetail {
  id: string;
  handle: string;
  brand: string;
  platform: string;
  avatar: number;
  profileUrl: string;
  status: AccountState;
  statusReason: string | null;
  followers: number | null;
  description: string;
  /** Link to the login in the password manager (never the password). */
  vaultUrl: string | null;
  slots: string[];
  /** Videos waiting to be posted. */
  backlog: number;
  /** Oldest first, at most FOLLOWER_DAYS days. */
  followerSeries: FollowerPoint[];
  /** Views of the posts published in the last 7 days (their latest refresh). */
  views7d: number;
  posts7d: number;
  /** Posts published in the last 24 hours (Instagram allows DAILY_POST_LIMIT). */
  postsUsed24h: number;
  /** null: no token stored (never connected, or a Sandbox example account). */
  connection: AccountConnection | null;
}

export interface AccountDetailInput {
  id: string;
  handle: string;
  brand: string;
  platform: string;
  status: AccountState;
  statusReason: string | null;
  followers: number | null;
  description: string;
  vaultUrl: string | null;
  slots: readonly string[];
}

export interface AccountPostInput {
  accountId: string;
  status: PostStatus;
  publishedAt: Date | null;
  /** Latest views (published posts). */
  views: number | null;
}

export interface CredentialInput {
  accountId: string;
  expiresAt: Date | null;
  scopes: readonly string[];
}

export interface AccountDetailsInput {
  accounts: readonly AccountDetailInput[];
  posts: readonly AccountPostInput[];
  followers: readonly { accountId: string; day: string; followers: number }[];
  credentials: readonly CredentialInput[];
  now: Date;
  timezone: string;
}

function isoDay(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** The first day the followers chart shows ("YYYY-MM-DD"). */
export function followerSince(now: Date, timezone: string): string {
  return isoDay(addDays(toLocalDate(now, timezone), -(FOLLOWER_DAYS - 1)));
}

/** Granted permission keys, from stored scopes. */
export function grantedPermissions(
  platform: string,
  scopes: readonly string[],
): Permission["key"][] {
  const p: ConnectPlatform = platform === "fake" ? "fake" : "instagram";
  const granted = new Set(scopes);
  const order: Permission["key"][] = ["profile", "publishing", "insights"];
  return order.filter((key) =>
    REQUIRED_PERMISSIONS.some((perm) => perm.key === key && granted.has(perm.scopes[p])),
  );
}

/** "Profile, publishing, insights". */
export function permissionsLabel(keys: readonly Permission["key"][]): string {
  if (keys.length === 0) return "None granted";
  const s = keys.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Drawer and preview data for every account, in the given order. */
export function buildAccountDetails(input: AccountDetailsInput): AccountDetail[] {
  const { now, timezone } = input;
  const since = followerSince(now, timezone);
  const week = now.getTime() - 7 * DAY_MS;
  const day = now.getTime() - DAY_MS;
  const creds = new Map(input.credentials.map((c) => [c.accountId, c]));

  return input.accounts.map((a) => {
    const posts = input.posts.filter((p) => p.accountId === a.id);
    const published = posts.filter(
      (p): p is AccountPostInput & { publishedAt: Date } =>
        p.status === "published" &&
        p.publishedAt !== null &&
        p.publishedAt.getTime() <= now.getTime(),
    );
    const lastWeek = published.filter((p) => p.publishedAt.getTime() >= week);
    const cred = creds.get(a.id);
    return {
      id: a.id,
      handle: a.handle,
      brand: a.brand,
      platform: a.platform,
      avatar: avatarIndex(a.id),
      profileUrl: profileUrl(a.platform, a.handle),
      status: a.status,
      statusReason: a.statusReason,
      followers: a.followers,
      description: a.description,
      vaultUrl: a.vaultUrl,
      slots: [...a.slots],
      backlog: posts.filter((p) => UPCOMING_STATUSES.has(p.status)).length,
      followerSeries: input.followers
        .filter((f) => f.accountId === a.id && f.day >= since)
        .map((f) => ({ day: f.day, followers: f.followers }))
        .sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0)),
      views7d: lastWeek.reduce((n, p) => n + (p.views ?? 0), 0),
      posts7d: lastWeek.length,
      postsUsed24h: published.filter((p) => p.publishedAt.getTime() > day).length,
      connection: cred
        ? { expiresAt: cred.expiresAt, permissions: grantedPermissions(a.platform, cred.scopes) }
        : null,
    };
  });
}

/** The connection line under an account: what's wrong, or that all is well. */
export function connectionNote(account: Pick<AccountDetail, "status" | "statusReason">): string {
  if (account.status === "ready") return "Connected. The access token renews automatically.";
  if (account.statusReason) return account.statusReason;
  return account.status === "not_connected"
    ? "Not connected yet. Connect it to start posting."
    : "Needs attention. Reconnect it to resume posting.";
}

/** Whole days until the token expires (negative: already expired). */
export function daysLeft(expiresAt: Date, now: Date): number {
  return Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS);
}

/** The followers gained (or lost) over the chart's range, or null with fewer than 2 points. */
export function followerChange(series: readonly FollowerPoint[]): number | null {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last || series.length < 2) return null;
  return last.followers - first.followers;
}
