/**
 * Connection health (BC-19; PRD → User flow 5). Pure: the scheduler's refreshTokens step and the
 * connect callback make the calls and writes.
 *
 * - Tokens: long-lived tokens last about 60 days. One is refreshed when it was last refreshed
 *   at least 24 h ago and expires within 7 days (docs/TDD.md → Tokens). A token that has already
 *   expired can't be refreshed: its account needs reconnecting.
 * - Instagram through Facebook Login (ADR 0006): Facebook doesn't renew a long-lived user token for
 *   a server. The account waits until RECONNECT_NOTICE_MS before expiry, then goes Needs
 *   attention with the date, so a Reconnect gives it a new 60-day token before posting stops.
 * - A refresh that fails because access is gone (expired, revoked, permission removed) or that
 *   retrying can't fix flags the account Needs attention. One that may pass (network, Instagram
 *   having a problem, rate limits) tries again an hour later.
 * - Connection check: a ready Instagram account's token is tried about once a minute (a cheap
 *   read), so revoking Broadcast in Instagram's settings shows within a couple of minutes.
 * - Needs attention pauses the account's queued posts (they keep their order); a successful
 *   reconnect puts them back in the queue, re-timed from now.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A token is refreshed only when it was last refreshed at least this long ago… */
export const REFRESH_MIN_AGE_MS = DAY_MS;
/** …and expires within this window. */
export const REFRESH_WINDOW_MS = 7 * DAY_MS;
/** A refresh that failed in a way that may pass tries again after this. */
export const REFRESH_RETRY_MS = HOUR_MS;
/** A token that can't be renewed asks for a reconnect this long before it expires. */
export const RECONNECT_NOTICE_MS = 3 * DAY_MS;
/** How often a ready Instagram account's token is checked (each tick, at most). */
export const CONNECTION_CHECK_MS = 55_000;

export interface TokenTimes {
  /** When the token was stored or last refreshed; null: unknown (treated as old enough). */
  lastRefreshedAt: Date | null;
  /** null: the platform gave no expiry, nothing to refresh. */
  expiresAt: Date | null;
}

export type RefreshPlan =
  /** Not due yet (or nothing to refresh). */
  | "none"
  /** Ask the platform for a new token. */
  | "refresh"
  /** Too late: the token has expired, the account needs reconnecting. */
  | "expired";

/** What to do with a token at `now` (the workspace clock). */
export function refreshPlan(token: TokenTimes, now: Date): RefreshPlan {
  if (!token.expiresAt) return "none";
  const t = now.getTime();
  if (token.expiresAt.getTime() <= t) return "expired";
  if (token.expiresAt.getTime() > t + REFRESH_WINDOW_MS) return "none";
  if (token.lastRefreshedAt && t - token.lastRefreshedAt.getTime() < REFRESH_MIN_AGE_MS) {
    return "none";
  }
  return "refresh";
}

/** What a failed refresh leads to. */
export function refreshFailure(err: { code: string; retryable: boolean }): "flag" | "retry" {
  if (err.code === "token_expired") return "flag";
  return err.retryable ? "retry" : "flag";
}

/**
 * What to do with a token the platform won't renew (refreshToken said `unsupported`), at `now`
 * (the workspace clock): wait until the notice period, or flag the account now.
 */
export function unrenewablePlan(
  expiresAt: Date,
  now: Date,
): { action: "wait"; askAt: Date } | { action: "flag" } {
  const askAt = expiresAt.getTime() - RECONNECT_NOTICE_MS;
  return askAt > now.getTime() ? { action: "wait", askAt: new Date(askAt) } : { action: "flag" };
}

/** The Needs attention reason when a token that can't be renewed is about to expire. */
export function reconnectSoonReason(expiresAt: Date, timezone: string): string {
  return `Instagram access ends on ${day(expiresAt, timezone)} and Facebook doesn't let Broadcast renew it. Reconnect to keep posting.`;
}

/** The job log line while such a token waits for its notice period. */
export function reconnectLaterLine(handle: string, askAt: Date, timezone: string): string {
  return `Facebook doesn't let Broadcast renew access for @${handle}. On ${day(askAt, timezone)} the account will ask to be reconnected.`;
}

/** True when the account's connection is due a check (never checked, or not for a while). */
export function connectionCheckDue(checkedAt: Date | null, realNow: Date): boolean {
  return !checkedAt || realNow.getTime() - checkedAt.getTime() >= CONNECTION_CHECK_MS;
}

function day(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: timezone })
    .format(date)
    .replace(".", "");
}

/** The account's Needs attention reason when its token ran out before it could be refreshed. */
export function expiredReason(expiresAt: Date, timezone: string): string {
  return `Instagram access expired on ${day(expiresAt, timezone)}. Reconnect to resume posting.`;
}

/** The reason when a refresh failed: the platform's own words, plus what to do. */
export function refreshFailedReason(userMessage: string): string {
  const text = userMessage.trim();
  return /reconnect/i.test(text)
    ? text
    : `Broadcast couldn't renew Instagram access: ${text.replace(/\.$/, "")}. Reconnect to resume posting.`;
}

/** The rail's line: "1 account needs attention", "2 accounts need attention"; null for none. */
export function attentionLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 account needs attention" : `${count} accounts need attention`;
}

/** The toast after a reconnect. */
export function reconnectedMessage(handle: string, resumed: boolean): string {
  return resumed
    ? `@${handle} reconnected. Its paused posts are back in the queue.`
    : `@${handle} reconnected.`;
}
