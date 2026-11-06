import {
  MAX_CAPTION_LENGTH,
  nextQueuePosition,
  timingProblem,
  type ContentTiming,
} from "./content";
import { DAILY_POST_LIMIT } from "./details";
import { whenLabel } from "./format";
import type { PostStatus, PostTiming } from "./queue";

/**
 * Editing the queue (BC-18): which posts may change, what an edit writes, and the toasts that
 * echo each action. Pure: src/lib/db/posts.ts does the reads and writes.
 */

/** Posts the dashboard may edit, post now or remove: waiting ones. Publishing ones belong to the scheduler. */
export const EDITABLE_STATUSES = ["queued", "paused"] as const satisfies readonly PostStatus[];

export function isEditable(status: PostStatus): boolean {
  return (EDITABLE_STATUSES as readonly PostStatus[]).includes(status);
}

export type EditProblem =
  | "caption_too_long"
  | "pinned_past"
  | "pinned_invalid"
  | "not_editable"
  | "account_paused"
  | "post_paused"
  | "quota_full";

export const EDIT_MESSAGES: Record<EditProblem, string> = {
  caption_too_long: `The caption is too long. Instagram allows ${MAX_CAPTION_LENGTH} characters.`,
  pinned_past: "The pinned time has passed. Choose a later time.",
  pinned_invalid: "Choose a date and time to pin the post to.",
  not_editable:
    "This post is being published (or is no longer in the queue), so it can't be changed. Reload to see where it is.",
  account_paused:
    "This account needs attention, so it can't post now. Reconnect it on the Accounts tab first.",
  post_paused:
    "This post is paused, so it can't post now. It resumes when its account is ready again.",
  quota_full: `This account has used all ${DAILY_POST_LIMIT} of its Instagram posts in the last 24 hours. Try again later.`,
};

/** A caption and timing edit, checked against the post's caption limit and the clock. */
export function editProblem(
  edit: { caption: string; timing: ContentTiming },
  now: Date,
): EditProblem | null {
  if (edit.caption.length > MAX_CAPTION_LENGTH) return "caption_too_long";
  return timingProblem(edit.timing, now);
}

export interface StoredTiming {
  timing: PostTiming;
  queuePosition: number | null;
  scheduledAt: Date | null;
}

/**
 * The timing columns an edit writes. A pin keeps the post's place in the backlog, so switching it
 * back to "Queue slot" returns it there; a post with no place joins the back of the queue. Queue
 * posts get their time from the planner afterwards.
 */
export function timingPatch(
  current: StoredTiming,
  timing: ContentTiming,
  accountPositions: readonly { queuePosition: number | null }[],
): StoredTiming {
  if (timing.kind === "pinned") {
    return { timing: "pinned", queuePosition: current.queuePosition, scheduledAt: timing.at };
  }
  if (current.timing === "queue") return current;
  return {
    timing: "queue",
    queuePosition: current.queuePosition ?? nextQueuePosition(accountPositions),
    scheduledAt: null,
  };
}

/** Why "Post now" can't run, or null when it can. */
export function postNowProblem(input: {
  status: PostStatus;
  accountStatus: string;
  /** Published in the last 24 hours, plus any being published now. */
  postsUsed24h: number;
}): EditProblem | null {
  if (!isEditable(input.status)) return "not_editable";
  if (input.accountStatus !== "ready") return "account_paused";
  // The scheduler only claims queued posts: a paused one would sit there "due" forever.
  if (input.status === "paused") return "post_paused";
  if (input.postsUsed24h >= DAILY_POST_LIMIT) return "quota_full";
  return null;
}

// ── Toasts ─────────────────────────────────────────────────────────────────────────────────────

/** "Changes saved. Pinned to Tomorrow, 16:30." */
export function savedMessage(
  timing: PostTiming,
  at: Date | null,
  now: Date,
  timezone: string,
): string {
  if (!at) return "Changes saved. It waits in the backlog until a slot opens.";
  const when = whenLabel(at, now, timezone);
  return timing === "pinned"
    ? `Changes saved. Pinned to ${when}.`
    : `Changes saved. Posts in its queue slot, ${when}.`;
}

export const POST_NOW_MESSAGE = "Posting now. The scheduler publishes it within a minute.";

/** "Removed from @codingjourney's queue. Later posts moved up." */
export function removedMessage(handle: string, timing: PostTiming): string {
  return timing === "queue"
    ? `Removed from @${handle}'s queue. Later posts moved up.`
    : `Removed from @${handle}'s queue.`;
}

/** "Added a 21:00 slot to @trip.app." / "Removed the 13:00 slot from @codingjourney." */
export function slotsMessage(handle: string, before: readonly string[], after: readonly string[]) {
  const added = after.filter((s) => !before.includes(s));
  const removed = before.filter((s) => !after.includes(s));
  if (added.length === 1 && removed.length === 0) return `Added a ${added[0]} slot to @${handle}.`;
  if (removed.length === 1 && added.length === 0) {
    return `Removed the ${removed[0]} slot from @${handle}.`;
  }
  return `Saved @${handle}'s posting slots.`;
}
