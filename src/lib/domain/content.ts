import { hm, whenLabel } from "./format";
import { openSlots, planQueue, type PlannerPost, type PostStatus } from "./queue";
import { toLocalDate, zonedTimeToUtc } from "./time";

/**
 * Adding content (BC-14, and the content API in BC-17): where a new post goes in an account's
 * backlog, which times change when it joins, and what the dashboard says afterwards. Pure.
 */

/** Instagram's caption limit. */
export const MAX_CAPTION_LENGTH = 2200;

export type ContentTiming = { kind: "queue" } | { kind: "pinned"; at: Date };

export interface ExistingPost extends PlannerPost {
  scheduledAt: Date | null;
}

/** The next free `queue_position`: after every post the account has (the back of the queue). */
export function nextQueuePosition(posts: readonly Pick<PlannerPost, "queuePosition">[]): number {
  let max = -1;
  for (const p of posts)
    if (p.queuePosition != null && p.queuePosition > max) max = p.queuePosition;
  return max + 1;
}

/** New posts wait (paused) on accounts that can't post right now. */
export function newPostStatus(accountStatus: string): Extract<PostStatus, "queued" | "paused"> {
  return accountStatus === "ready" ? "queued" : "paused";
}

export interface TimeChange {
  id: string;
  scheduledAt: Date | null;
}

/**
 * Runs the queue planner over an account's posts and returns the planned posts whose time is not
 * what's stored (the new post always, others when a pin took their slot).
 */
export function timeChanges(input: {
  slots: readonly string[];
  timezone: string;
  now: Date;
  posts: readonly ExistingPost[];
}): TimeChange[] {
  const stored = new Map(input.posts.map((p) => [p.id, p.scheduledAt?.getTime() ?? null]));
  return planQueue(input).filter(
    (planned) => (planned.scheduledAt?.getTime() ?? null) !== stored.get(planned.id),
  );
}

/**
 * Queue posts that are due (their time has come) or held by a tick keep their time when the queue
 * is re-timed: they're handed to the planner as fixed, like a pin, so an edit never pushes a post
 * the scheduler is about to publish to a later slot.
 */
export function holdDue(
  posts: readonly (ExistingPost & { claimed?: boolean })[],
  now: Date,
): ExistingPost[] {
  return posts.map(({ claimed, ...p }) =>
    p.timing === "queue" &&
    p.status === "queued" &&
    p.scheduledAt &&
    (claimed || p.scheduledAt.getTime() <= now.getTime())
      ? { ...p, timing: "pinned" }
      : p,
  );
}

export type TimingProblem = "pinned_past" | "pinned_invalid";

/** A pinned time must be a real instant after now. */
export function timingProblem(timing: ContentTiming, now: Date): TimingProblem | null {
  if (timing.kind !== "pinned") return null;
  if (Number.isNaN(timing.at.getTime())) return "pinned_invalid";
  if (timing.at.getTime() <= now.getTime()) return "pinned_past";
  return null;
}

/**
 * A `datetime-local` value ("2026-11-07T12:00") read as wall-clock time in the workspace
 * timezone. Null when it isn't one.
 */
export function localInputToUtc(value: string, timezone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return zonedTimeToUtc({ year, month, day }, hour * 60 + minute, timezone);
}

/** The reverse: an instant as a `datetime-local` value in the workspace timezone. */
export function utcToLocalInput(instant: Date, timezone: string): string {
  const d = toLocalDate(instant, timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.year}-${pad(d.month)}-${pad(d.day)}T${hm(instant, timezone)}`;
}

/** The earliest of the new posts' times (null when none has one). */
export function firstTime(times: readonly (Date | null)[]): Date | null {
  let first: Date | null = null;
  for (const t of times) if (t && (!first || t < first)) first = t;
  return first;
}

/** "Added to 2 queues. First post Tomorrow, 13:00." */
export function addedMessage(
  queues: number,
  first: Date | null,
  now: Date,
  timezone: string,
): string {
  const added = `Added to ${queues} queue${queues === 1 ? "" : "s"}`;
  return first
    ? `${added}. First post ${whenLabel(first, now, timezone)}.`
    : `${added}. It waits in the backlog until a slot opens.`;
}

/**
 * Where a video added now with "Next open slot" would go: the first free slot after the account's
 * backlog (the same walk as the planner). Null when the account has no slots.
 */
export function nextOpenSlot(input: {
  slots: readonly string[];
  timezone: string;
  now: Date;
  posts: readonly PlannerPost[];
}): Date | null {
  return openSlots({ ...input, count: 1 })[0] ?? null;
}

/** One account in the Add content dialog's "Post to" list. */
export interface ContentAccount {
  id: string;
  handle: string;
  platform: string;
  /** 1–6, the account's avatar colour. */
  avatar: number;
  /** Paused: new posts wait until the account is reconnected. */
  paused: boolean;
  /** Where a queued video would go now (ISO), or null when the account has no slots. */
  nextOpenSlot: string | null;
}
