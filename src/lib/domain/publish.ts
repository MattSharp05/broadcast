import { whenLabel } from "./format";
import { planQueue, type PostStatus } from "./queue";

/**
 * The publish state machine (docs/TDD.md → Publishing; ADR 0002). Pure: the scheduler's
 * publishDue step loads a claimed post, asks `nextPublishAction` what to do, makes the provider
 * calls, describes what happened as a `PublishOutcome`, and saves what `applyPublishOutcome`
 * returns. One step per tick; waiting happens between ticks.
 *
 *   queued ──(due, account ready, quota free)── create container ──▶ publishing (container_id)
 *   publishing ── check container ──▶ still processing: check again next tick
 *                                  ├▶ finished: check the quota, publish ──▶ published
 *                                  └▶ already published (a lost answer): find it ──▶ published
 *   quota used up (before uploading or before publishing): wait for the account's next slot,
 *   without using a retry.
 *   any error: retry after 1, 2, then 4 min (3 retries); the next error, or one that can't be
 *   fixed by retrying, ends in failed with last_error.
 *   account not ready (or its token expired) ──▶ paused.
 *
 * Never twice (CLAUDE.md → Rules): a post has at most one container at a time and its id is saved
 * before anything else happens; only that container is ever published, and Instagram publishes a
 * container at most once. A container is checked before every publish, so one that was published
 * already (the tick crashed, or the answer timed out) is recognised, not published again. A
 * container that ends in an error or expires is dropped and the retry uploads a new one.
 */

/** Minutes to wait before retry 1, 2 and 3. */
export const PUBLISH_BACKOFF_MINUTES = [1, 2, 4] as const;
/** Retries after the first error; the error after the last retry fails the post. */
export const PUBLISH_MAX_RETRIES = PUBLISH_BACKOFF_MINUTES.length;
/** How long a post waits when the account's publishing quota is used up. */
export const QUOTA_WAIT_MINUTES = 15;

const MINUTE_MS = 60_000;

export type AccountStatus = "ready" | "needs_attention" | "not_connected";

export interface PublishPost {
  status: PostStatus;
  containerId: string | null;
  /** Errors so far (each one used a retry). */
  attempts: number;
}

export interface PublishAccount {
  handle: string;
  status: AccountStatus;
  statusReason: string | null;
}

export type PublishAction =
  /** The account can't post: park the post until it is reconnected. */
  | { kind: "pause"; reason: string }
  /** Check the quota, then upload the video as a new container. */
  | { kind: "create_container" }
  /** Ask whether the container is ready; publish it when it is. */
  | { kind: "check_container"; containerId: string }
  /** Nothing to do (the post isn't queued or publishing any more). */
  | { kind: "none" };

export type PublishErrorCode =
  | "token_expired"
  | "quota_exhausted"
  | "invalid_media"
  | "network"
  | "not_ready"
  | "not_found"
  | "unsupported"
  /** The platform doesn't renew this token; only a reconnect gives a new one. */
  | "not_renewable"
  | "unknown";

/** When a post blocked by the publishing quota tries again, and how the log says it. */
export interface QuotaWait {
  at: Date;
  label: string;
}

export type PublishOutcome =
  | { kind: "paused"; reason: string }
  | { kind: "quota_full"; message: string; wait?: QuotaWait }
  | { kind: "container_created"; containerId: string }
  | { kind: "processing" }
  /** Ids are null only when an already-published container's post couldn't be found. */
  | { kind: "published"; mediaId: string | null; permalink: string | null }
  | {
      kind: "error";
      code: PublishErrorCode;
      retryable: boolean;
      /** What the dashboard shows. */
      message: string;
      /** The container can't be used again (it errored, or the platform doesn't know it). */
      dropContainer?: boolean;
    };

/** The post columns a step writes (snake_case, as stored). */
export interface PublishPatch {
  status: PostStatus;
  container_id?: string | null;
  container_created_at?: string | null;
  attempts?: number;
  next_attempt_at?: string | null;
  last_error?: string | null;
  published_at?: string;
  media_ig_id?: string | null;
  permalink?: string | null;
}

export interface PublishResult {
  patch: PublishPatch;
  /** The job_log line. */
  log: { ok: boolean; message: string };
  /** Set when the account itself needs attention (its token expired): the reason to show. */
  accountProblem?: string;
}

export function pausedReason(account: PublishAccount): string {
  return (
    account.statusReason ??
    `@${account.handle} needs attention. Reconnect it in Accounts to resume posting.`
  );
}

/** What to do with a claimed post. */
export function nextPublishAction(post: PublishPost, account: PublishAccount): PublishAction {
  if (post.status !== "queued" && post.status !== "publishing") return { kind: "none" };
  // A container that already exists can still be published, but nothing new starts on an
  // account that can't post.
  if (account.status !== "ready" && !post.containerId) {
    return { kind: "pause", reason: pausedReason(account) };
  }
  if (post.containerId) return { kind: "check_container", containerId: post.containerId };
  return { kind: "create_container" };
}

/**
 * When a post blocked by the quota tries again: the account's next slot (Instagram's window is a
 * rolling 24 hours, so a slot later it may have room), or QUOTA_WAIT_MINUTES when the account has
 * no slots.
 */
export function quotaWait(input: {
  slots: readonly string[];
  timezone: string;
  now: Date;
}): QuotaWait {
  let next: Date | null = null;
  try {
    const [planned] = planQueue({
      ...input,
      posts: [{ id: "next", timing: "queue", queuePosition: 0, status: "queued" }],
    });
    next = planned?.scheduledAt ?? null;
  } catch {
    // Invalid slots: fall back to the fixed wait.
  }
  if (next) {
    return { at: next, label: `the next slot (${whenLabel(next, input.now, input.timezone)})` };
  }
  return {
    at: new Date(input.now.getTime() + QUOTA_WAIT_MINUTES * MINUTE_MS),
    label: `${QUOTA_WAIT_MINUTES} min`,
  };
}

/** Minutes before retry `retry` (1-based), or null when there are no retries left. */
export function backoffMinutes(retry: number): number | null {
  return PUBLISH_BACKOFF_MINUTES[retry - 1] ?? null;
}

/** What a post that stopped retrying says it did (BC-20). */
export const STOPPED_NOTE = `Broadcast stopped after ${PUBLISH_MAX_RETRIES} retries. Use Retry now once it's fixed.`;

/**
 * The reason a post that ran out of retries shows: the error without "Broadcast will try again",
 * which is no longer true, and what to do instead.
 */
export function stoppedReason(message: string): string {
  const kept = message.replace(/\s*Broadcast will (try|upload it) again[^.]*\./g, "").trim();
  return kept ? `${kept} ${STOPPED_NOTE}` : STOPPED_NOTE;
}

/** The post's new state and the log line after one step. `now` is the workspace clock. */
export function applyPublishOutcome(
  post: PublishPost,
  outcome: PublishOutcome,
  now: Date,
): PublishResult {
  const at = (minutes: number) => new Date(now.getTime() + minutes * MINUTE_MS).toISOString();

  switch (outcome.kind) {
    case "paused":
      return {
        patch: { status: "paused", next_attempt_at: null, last_error: outcome.reason },
        log: { ok: false, message: `Paused: ${outcome.reason}` },
      };

    case "quota_full": {
      // Not an error: the post (and its container, if it has one) waits for the rolling 24-hour
      // window to free up.
      const wait = outcome.wait ?? {
        at: new Date(now.getTime() + QUOTA_WAIT_MINUTES * MINUTE_MS),
        label: `${QUOTA_WAIT_MINUTES} min`,
      };
      return {
        patch: {
          status: post.status,
          next_attempt_at: wait.at.toISOString(),
          last_error: outcome.message,
        },
        log: { ok: false, message: `Waiting until ${wait.label}: ${outcome.message}` },
      };
    }

    case "container_created":
      // Checked on the next tick.
      return {
        patch: {
          status: "publishing",
          container_id: outcome.containerId,
          container_created_at: now.toISOString(),
          next_attempt_at: now.toISOString(),
          last_error: null,
        },
        log: { ok: true, message: `Uploaded the video (container ${outcome.containerId}).` },
      };

    case "processing":
      return {
        patch: { status: "publishing", next_attempt_at: now.toISOString() },
        log: { ok: true, message: "The platform is still processing the video." },
      };

    case "published":
      return {
        patch: {
          status: "published",
          published_at: now.toISOString(),
          media_ig_id: outcome.mediaId,
          permalink: outcome.permalink,
          next_attempt_at: null,
          last_error: null,
        },
        log: {
          ok: true,
          message: outcome.permalink
            ? `Published: ${outcome.permalink}`
            : "Published. Instagram already had it (an earlier answer was lost); its link couldn't be found.",
        },
      };

    case "error": {
      if (outcome.code === "token_expired") {
        return {
          patch: { status: "paused", next_attempt_at: null, last_error: outcome.message },
          log: { ok: false, message: `Paused: ${outcome.message}` },
          accountProblem: outcome.message,
        };
      }
      const containerId = outcome.dropContainer ? null : post.containerId;
      const dropped = post.containerId !== null && containerId === null;
      const status: PostStatus = containerId ? "publishing" : "queued";
      const attempts = post.attempts + 1;
      const wait = outcome.retryable ? backoffMinutes(attempts) : null;
      if (wait === null) {
        return {
          patch: {
            status: "failed",
            container_id: containerId,
            ...(dropped ? { container_created_at: null } : {}),
            attempts,
            next_attempt_at: null,
            last_error: outcome.retryable ? stoppedReason(outcome.message) : outcome.message,
          },
          log: {
            ok: false,
            message: outcome.retryable
              ? `Failed after ${PUBLISH_MAX_RETRIES} retries: ${outcome.message}`
              : `Failed: ${outcome.message}`,
          },
        };
      }
      return {
        patch: {
          status,
          container_id: containerId,
          ...(dropped ? { container_created_at: null } : {}),
          attempts,
          next_attempt_at: at(wait),
          last_error: outcome.message,
        },
        log: { ok: false, message: `Retrying in ${wait} min: ${outcome.message}` },
      };
    }
  }
}
