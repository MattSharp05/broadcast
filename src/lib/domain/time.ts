/**
 * Timezone helpers for slot maths, built on `Intl` (no dependency).
 * Instants are always `Date`s (UTC); a timezone is an IANA name such as `America/New_York`.
 */

/** A calendar date in some timezone. `month` is 1–12. */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    // Throws RangeError for an unknown timezone.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/** The wall-clock fields of `instant` in `timezone`, as if they were UTC (ms since epoch). */
function wallClockAsUtc(instant: number, timezone: string): number {
  const fields: Record<string, string> = {};
  for (const part of formatterFor(timezone).formatToParts(instant)) {
    fields[part.type] = part.value;
  }
  return Date.UTC(
    Number(fields.year),
    Number(fields.month) - 1,
    Number(fields.day),
    Number(fields.hour),
    Number(fields.minute),
    Number(fields.second),
  );
}

/** The UTC offset of `timezone` at `instant`, in ms (e.g. −5 h for New York in winter). */
export function timezoneOffsetMs(instant: number, timezone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return wallClockAsUtc(whole, timezone) - whole;
}

/** The calendar date of `instant` in `timezone`. */
export function toLocalDate(instant: Date, timezone: string): LocalDate {
  const wall = new Date(wallClockAsUtc(instant.getTime(), timezone));
  return { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate() };
}

/** `date` moved by `days` calendar days (handles month and year ends). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

/**
 * The instant at which the wall clock in `timezone` shows `minutes` after midnight on `date`.
 *
 * DST rules:
 * - A wall time that occurs twice (clocks go back) resolves to the **first** occurrence.
 * - A wall time that doesn't exist (clocks go forward) is **shifted forward by the gap**,
 *   e.g. 02:30 on a New York spring-forward day becomes 03:30 EDT.
 */
export function zonedTimeToUtc(date: LocalDate, minutes: number, timezone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day) + minutes * MINUTE_MS;
  // The offsets either side of this day; real zones change at most once within ±1 day.
  const offsetBefore = timezoneOffsetMs(wall - DAY_MS, timezone);
  const offsetAfter = timezoneOffsetMs(wall + DAY_MS, timezone);
  const candidates = [wall - offsetBefore, wall - offsetAfter].filter(
    (instant) => wallClockAsUtc(instant, timezone) === wall,
  );
  if (candidates.length === 0) {
    // In a gap: read the wall time with the pre-transition offset, which lands after the gap.
    return new Date(wall - offsetBefore);
  }
  return new Date(Math.min(...candidates));
}
