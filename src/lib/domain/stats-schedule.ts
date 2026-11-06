import { STAT_OFFSETS, type StatOffset } from "@/lib/domain/details";
import { toLocalDate } from "@/lib/domain/time";

/**
 * When a post's stats snapshots are due, and when an account's daily follower count is (BC-21).
 * Pure: the scheduler's stats step (src/lib/scheduler/collect-stats.ts) loads the rows and acts
 * on the plan.
 *
 * Snapshots are due at +1 h, +6 h, +24 h, +48 h and +7 days after publishing. One insights call
 * gives the numbers as they are now, so after downtime (several offsets due at once) only the
 * latest due offset is filled with them; the earlier ones are marked missed, in order, rather than
 * given numbers that weren't true at their time.
 */

const HOUR_MS = 3_600_000;

export const STAT_OFFSET_HOURS: Record<StatOffset, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  "48h": 48,
  "7d": 168,
};

/** When a snapshot is due for a post published at `publishedAt`. */
export function statDueAt(publishedAt: Date, offset: StatOffset): Date {
  return new Date(publishedAt.getTime() + STAT_OFFSET_HOURS[offset] * HOUR_MS);
}

/** A post's existing snapshot row. */
export interface StatRowState {
  offset: StatOffset;
  /** Filled in (or marked missed) at this time; null while still to come. */
  takenAt: Date | null;
}

export interface StatsPlan {
  /** The snapshot to fill with the numbers fetched now; null when nothing is due. */
  take: StatOffset | null;
  /** Earlier snapshots that are due but were never taken (downtime), in order: marked missed. */
  missed: StatOffset[];
}

/**
 * Which snapshots are due for a post at `now`. An offset with no row counts as not taken (the step
 * creates it). An offset whose time hasn't come is never due.
 */
export function dueSnapshots(input: {
  publishedAt: Date;
  rows: readonly StatRowState[];
  now: Date;
}): StatsPlan {
  const taken = new Set(input.rows.filter((r) => r.takenAt !== null).map((r) => r.offset));
  const due = STAT_OFFSETS.filter(
    (o) => !taken.has(o) && statDueAt(input.publishedAt, o).getTime() <= input.now.getTime(),
  );
  const take = due.at(-1) ?? null;
  return { take, missed: due.slice(0, -1) };
}

/** "YYYY-MM-DD" of `now` in `timezone`: the day an account's follower count belongs to. */
export function followerDay(now: Date, timezone: string): string {
  const d = toLocalDate(now, timezone);
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** True when the account has no follower count for today yet (once a day per account). */
export function followersDue(lastDay: string | null, now: Date, timezone: string): boolean {
  return lastDay === null || lastDay < followerDay(now, timezone);
}
