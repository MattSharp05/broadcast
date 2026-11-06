import { parseSlotTime, type SlotMinutes } from "@/lib/domain/slot-time";
import { addDays, toLocalDate, zonedTimeToUtc } from "@/lib/domain/time";

export type PostTiming = "queue" | "pinned";
export type PostStatus = "queued" | "publishing" | "published" | "failed" | "paused" | "removed";

export interface PlannerPost {
  id: string;
  timing: PostTiming;
  /** Order in the account's backlog (lower goes first). Posts without one go last. */
  queuePosition?: number | null;
  /** For pinned posts, the exact time chosen by the user. */
  scheduledAt?: Date | null;
  status: PostStatus;
}

export interface QueueInput {
  /** Daily slots as `HH:MM` in `timezone`. */
  slots: readonly string[];
  /** IANA timezone of the workspace, e.g. `Europe/London`. */
  timezone: string;
  now: Date;
  /** Every post of one account. */
  posts: readonly PlannerPost[];
}

export interface PlannedTime {
  id: string;
  /** `null` when the account has no slots: the post waits in the backlog. */
  scheduledAt: Date | null;
}

const MINUTE_MS = 60_000;
/** Slots at or before now + this margin are skipped, so a post is never due the moment it's planned. */
const LEAD_MS = MINUTE_MS;

/** Statuses of queue posts the planner (re)times. */
const PLANNED_STATUSES: ReadonlySet<PostStatus> = new Set(["queued", "paused"]);
/** Statuses of other posts that still hold their time, so their slot isn't free. */
const HOLDING_STATUSES: ReadonlySet<PostStatus> = new Set(["queued", "paused", "publishing"]);

function isPlanned(post: PlannerPost): boolean {
  return post.timing === "queue" && PLANNED_STATUSES.has(post.status);
}

/** Times compare at minute precision, so a pin at 19:00:30 still takes the 19:00 slot. */
function minuteKey(instant: Date): number {
  return Math.floor(instant.getTime() / MINUTE_MS);
}

function parseSlots(slots: readonly string[]): SlotMinutes[] {
  return slots.map((slot) => {
    const minutes = parseSlotTime(slot);
    if (minutes === null) throw new RangeError(`Invalid slot time: ${JSON.stringify(slot)}`);
    return minutes;
  });
}

/** Minutes held by pinned (or publishing) posts. A pin that matches no slot simply never collides. */
function heldMinutes(posts: readonly PlannerPost[]): Set<number> {
  const held = new Set<number>();
  for (const post of posts) {
    if (!isPlanned(post) && post.scheduledAt && HOLDING_STATUSES.has(post.status)) {
      held.add(minuteKey(post.scheduledAt));
    }
  }
  return held;
}

/** Queue posts to time, in backlog order (queuePosition, then input order). */
function backlog(posts: readonly PlannerPost[]): PlannerPost[] {
  return posts
    .map((post, index) => ({ post, index, position: post.queuePosition ?? Infinity }))
    .filter(({ post }) => isPlanned(post))
    .sort((a, b) => a.position - b.position || a.index - b.index)
    .map(({ post }) => post);
}

/** Every future slot instant after now + 1 min that isn't in `taken`, in time order, forever. */
function* freeSlots(
  slotMinutes: readonly SlotMinutes[],
  timezone: string,
  now: Date,
  taken: ReadonlySet<number>,
): Generator<Date, never, undefined> {
  const earliest = now.getTime() + LEAD_MS;
  for (let date = toLocalDate(now, timezone); ; date = addDays(date, 1)) {
    // Sorted and de-duplicated: a DST gap can move a slot past (or onto) a later one.
    const instants = [
      ...new Set(slotMinutes.map((m) => zonedTimeToUtc(date, m, timezone).getTime())),
    ].sort((a, b) => a - b);
    for (const instant of instants) {
      const slot = new Date(instant);
      if (instant > earliest && !taken.has(minuteKey(slot))) yield slot;
    }
  }
}

/**
 * Times every `queue` post with status `queued`/`paused`: each takes the next free slot in
 * backlog order. Pinned posts keep their time and take the slot at that time, if there is one.
 * With no slots configured every queue post gets `scheduledAt: null`.
 */
export function planQueue(input: QueueInput): PlannedTime[] {
  const slotMinutes = parseSlots(input.slots);
  const queue = backlog(input.posts);
  if (slotMinutes.length === 0) return queue.map(({ id }) => ({ id, scheduledAt: null }));

  const slots = freeSlots(slotMinutes, input.timezone, input.now, heldMinutes(input.posts));
  return queue.map(({ id }) => ({ id, scheduledAt: slots.next().value }));
}

/** The next `count` slot times not taken by a planned or pinned post (for open-slot cards). */
export function openSlots(input: QueueInput & { count: number }): Date[] {
  const slotMinutes = parseSlots(input.slots);
  if (slotMinutes.length === 0) return [];

  // Same walk as planQueue: the first slots go to the backlog, the ones after it are open.
  const slots = freeSlots(slotMinutes, input.timezone, input.now, heldMinutes(input.posts));
  for (let i = backlog(input.posts).length; i > 0; i--) slots.next();
  return Array.from({ length: Math.max(0, input.count) }, () => slots.next().value);
}
