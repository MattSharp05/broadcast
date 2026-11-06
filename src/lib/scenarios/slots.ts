import { parseSlotTime } from "@/lib/domain/slot-time";
import { addDays, toLocalDate, zonedTimeToUtc, type LocalDate } from "@/lib/domain/time";

/** The `count` most recent slot times strictly before `now`, newest first. */
export function pastSlotTimes(
  slots: readonly string[],
  timezone: string,
  now: Date,
  count: number,
): Date[] {
  const minutes = slots
    .map((s) => parseSlotTime(s))
    .filter((m): m is number => m !== null)
    .sort((a, b) => b - a);
  if (minutes.length === 0 || count <= 0) return [];
  const out: Date[] = [];
  let day: LocalDate = toLocalDate(now, timezone);
  while (out.length < count) {
    for (const m of minutes) {
      const at = zonedTimeToUtc(day, m, timezone);
      if (at < now && out.length < count) out.push(at);
    }
    day = addDays(day, -1);
  }
  return out;
}

/** `YYYY-MM-DD` of an instant in a timezone. */
export function isoDay(date: LocalDate): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}
