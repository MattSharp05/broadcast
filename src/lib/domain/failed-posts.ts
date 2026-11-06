import { DAILY_POST_LIMIT } from "./details";
import { hm, sameLocalDay, whenLabel } from "./format";
import type { PostStatus } from "./queue";

/**
 * Failed posts (BC-20): what "Retry now", "Replace video" and "Remove" write, when they are
 * refused, the toasts that echo them and the drawer's list of attempts. Pure: the reads and
 * writes are in src/lib/db/failed-posts.ts.
 *
 * Never twice (CLAUDE.md → Rules): a failed post can keep its container when the last error came
 * after the upload (e.g. the answer to "publish" was lost, so it may be live already). Retry then
 * hands that container back to the scheduler, which checks it before anything else and recovers
 * the post if Instagram already published it. Replacing the video would drop that container and
 * removing the post would lose a live post, so both are refused until a retry has settled it.
 */

export type FailedProblem = "not_failed" | "account_paused" | "quota_full" | "container_kept";

export const FAILED_MESSAGES: Record<FailedProblem, string> = {
  not_failed:
    "This post isn't failed any more (it is being retried or was removed). Reload to see where it is.",
  account_paused:
    "This account needs attention, so it can't post now. Reconnect it on the Accounts tab first.",
  quota_full: `This account has used all ${DAILY_POST_LIMIT} of its Instagram posts in the last 24 hours. Try again later.`,
  container_kept:
    "Instagram may already have this video, so it can't be replaced or removed yet. Retry now first: it checks the upload before posting anything.",
};

export interface FailedPostState {
  status: PostStatus;
  /** The kept container, when the failure came after the upload. */
  containerId: string | null;
  accountStatus: string;
  /** Published in the last 24 hours, plus any being published now. */
  postsUsed24h: number;
}

/**
 * Why "Retry now" can't run, or null when it can. A kept container is always worth checking: that
 * posts nothing new (the scheduler checks the quota before it publishes a finished container, and
 * may check one on an account that needs attention), and it is how a post that is live already is
 * recovered.
 */
export function retryProblem(post: FailedPostState): FailedProblem | null {
  if (post.status !== "failed") return "not_failed";
  if (post.containerId) return null;
  if (post.accountStatus !== "ready") return "account_paused";
  if (post.postsUsed24h >= DAILY_POST_LIMIT) return "quota_full";
  return null;
}

/** Why "Replace video" can't run, or null when it can. */
export function replaceProblem(post: FailedPostState): FailedProblem | null {
  if (post.status !== "failed") return "not_failed";
  if (post.containerId) return "container_kept";
  if (post.accountStatus !== "ready") return "account_paused";
  if (post.postsUsed24h >= DAILY_POST_LIMIT) return "quota_full";
  return null;
}

/** Why "Remove" can't run: a kept container may be live already, so Retry settles it first. */
export function removeProblem(post: FailedPostState): FailedProblem | null {
  if (post.status !== "failed") return "not_failed";
  if (post.containerId) return "container_kept";
  return null;
}

/** The post columns a retry (or a replaced video) writes. */
export interface RetryPatch {
  status: "queued" | "publishing";
  attempts: 0;
  last_error: null;
  next_attempt_at: string | null;
  timing?: "pinned";
  scheduled_at?: string;
}

/**
 * Makes a failed post due now, with its retries reset; the scheduler's next tick takes it. With a
 * kept container the post goes back to `publishing`, so the scheduler checks that container first
 * (and recovers a post that is already live) instead of uploading again. Without one it is pinned
 * to now, like "Post now".
 */
export function retryPatch(containerId: string | null, now: Date): RetryPatch {
  const at = now.toISOString();
  if (containerId) {
    return { status: "publishing", attempts: 0, last_error: null, next_attempt_at: at };
  }
  return {
    status: "queued",
    attempts: 0,
    last_error: null,
    next_attempt_at: null,
    timing: "pinned",
    scheduled_at: at,
  };
}

// ── Toasts and log lines ───────────────────────────────────────────────────────────────────────

export const RETRY_MESSAGE = "Retrying now. The scheduler tries again within a minute.";
export const REPLACED_MESSAGE = "Video replaced. The scheduler posts it within a minute.";

export function removedFailedMessage(handle: string): string {
  return `Removed the failed post from @${handle}.`;
}

/** job_log lines the dashboard writes, so the attempts list shows them. */
export const RETRY_LOG = "Retry requested from the dashboard.";
export const REPLACE_LOG = "Video replaced from the dashboard; retrying.";

// ── Attempts list ──────────────────────────────────────────────────────────────────────────────

export interface JobLogLine {
  at: Date;
  ok: boolean;
  message: string | null;
}

export interface AttemptRow {
  /** "22:13", or "Yesterday, 22:13" for another day. */
  time: string;
  /** A short result ("Uploaded", "Error, retry in 2 min", "Failed, stopped"). */
  result: string;
  /** The full log message. */
  message: string;
  ok: boolean;
}

/** How many attempts the drawer lists (the latest ones). */
export const ATTEMPTS_SHOWN = 8;

/** The short result for one publish log line. */
export function attemptResult(line: JobLogLine): string {
  const m = line.message ?? "";
  if (m === RETRY_LOG) return "Retry requested";
  if (m === REPLACE_LOG) return "Video replaced";
  if (m.startsWith("Uploaded")) return "Uploaded";
  if (m.startsWith("Published")) return "Published";
  if (m.startsWith("The platform is still processing")) return "Processing";
  const retry = /^Retrying in (\d+) min/.exec(m);
  if (retry) return `Error, retry in ${retry[1]} min`;
  if (m.startsWith("Failed")) return "Failed, stopped";
  if (m.startsWith("Waiting until")) return "Waiting for quota";
  if (m.startsWith("Paused")) return "Paused";
  return line.ok ? "Done" : "Error";
}

/** The drawer's "Attempts" rows: the latest ATTEMPTS_SHOWN log lines, oldest first. */
export function attemptRows(
  lines: readonly JobLogLine[],
  now: Date,
  timezone: string,
): AttemptRow[] {
  return [...lines]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-ATTEMPTS_SHOWN)
    .map((line) => ({
      time: sameLocalDay(line.at, now, timezone)
        ? hm(line.at, timezone)
        : whenLabel(line.at, now, timezone),
      result: attemptResult(line),
      message: line.message ?? "",
      ok: line.ok,
    }));
}
