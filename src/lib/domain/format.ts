import { toLocalDate, type LocalDate } from "@/lib/domain/time";

/**
 * Display formats from docs/DESIGN.md → Copy: "Today, 19:00", "Tomorrow, 09:00", "Sat 7 Nov,
 * 12:00"; relative "in 9 h 46 min" or "3 h ago"; the countdown chip's short "10h 46m".
 * Times are shown in the workspace timezone.
 */

const MINUTE_MS = 60_000;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const hmFormatters = new Map<string, Intl.DateTimeFormat>();

function hmFormatter(timezone: string): Intl.DateTimeFormat {
  let f = hmFormatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    hmFormatters.set(timezone, f);
  }
  return f;
}

/** "22:14" in the timezone. */
export function hm(instant: Date, timezone: string): string {
  return hmFormatter(timezone).format(instant);
}

function dayNumber(d: LocalDate): number {
  return Date.UTC(d.year, d.month - 1, d.day) / 86_400_000;
}

/** "Thu 5 Nov" for a local date. */
function dateLabel(d: LocalDate): string {
  const dow = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  return `${DOW[dow] ?? ""} ${d.day} ${MON[d.month - 1] ?? ""}`;
}

/** True when both instants fall on the same calendar day in the timezone. */
export function sameLocalDay(a: Date, b: Date, timezone: string): boolean {
  return dayNumber(toLocalDate(a, timezone)) === dayNumber(toLocalDate(b, timezone));
}

/** "Today", "Tomorrow", "Yesterday" or "Sat 7 Nov". */
export function dayLabel(instant: Date, now: Date, timezone: string): string {
  const day = toLocalDate(instant, timezone);
  const diff = dayNumber(day) - dayNumber(toLocalDate(now, timezone));
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return dateLabel(day);
}

/** "Today, 19:00", "Tomorrow, 09:00", "Sat 7 Nov, 12:00". */
export function whenLabel(instant: Date, now: Date, timezone: string): string {
  return `${dayLabel(instant, now, timezone)}, ${hm(instant, timezone)}`;
}

/** The now tag: "Thu 5 Nov, 22:14" (always the date, never "Today"). */
export function nowLabel(now: Date, timezone: string): string {
  return `${dateLabel(toLocalDate(now, timezone))}, ${hm(now, timezone)}`;
}

function minutesUntil(instant: Date, now: Date): number {
  return Math.max(0, Math.round((instant.getTime() - now.getTime()) / MINUTE_MS));
}

/** The countdown chip: "46m", "10h 46m", "2d 3h". */
export function shortCountdown(instant: Date, now: Date): string {
  const m = minutesUntil(instant, now);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "in 46 min", "in 9 h 46 min", "in 2 days". */
export function inFrom(instant: Date, now: Date): string {
  const m = minutesUntil(instant, now);
  if (m < 1) return "now";
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h} h ${m % 60} min`;
  const days = Math.round(h / 24);
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

/** 312, 1.2K, 54K, 1.3M. */
export function compactCount(n: number): string {
  const trim = (s: string) => s.replace(/\.0$/, "");
  if (n >= 1e6) return `${trim((n / 1e6).toFixed(1))}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (n >= 1e3) return `${trim((n / 1e3).toFixed(1))}K`;
  return String(n);
}

/** A video length: "0:42", "1:05". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
