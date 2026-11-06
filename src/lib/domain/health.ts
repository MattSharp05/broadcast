/**
 * Connection health (BC-19; PRD → User flow 5). Pure: the scheduler's refreshTokens step and the
 * connect callback make the calls and writes.
 *
 * - Tokens: Instagram long-lived tokens last 60 days. One is refreshed when it was last refreshed
 *   at least 24 h ago and expires within 7 days (docs/TDD.md → Tokens). A token that has already
 *   expired can't be refreshed: its account needs reconnecting.
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
