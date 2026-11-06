/**
 * The rail footer's scheduler line (ADR 0002): green "Scheduler running, checked at 22:14" while
 * ticks arrive, amber "Scheduler: last tick 12 min ago" when they stop. Pure.
 */

/** A tick older than this counts as stopped (ticks come every minute; one late one is fine). */
export const SCHEDULER_STALE_MS = 3 * 60_000;

export interface SchedulerLine {
  tone: "good" | "warn";
  title: string;
  detail: string;
}

/** "22:14" in the timezone (24-hour clock). */
export function clockTime(at: Date, timezone: string | null): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone ?? "UTC",
  }).format(at);
}

/** "12 min", "3 h", "2 days". */
export function ageLabel(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * `now` is real time (the scheduler always runs on real time, even when the Sandbox clock is
 * frozen); `timezone` only formats the time.
 */
export function schedulerLine(
  lastTickAt: Date | null,
  now: Date,
  timezone: string | null,
): SchedulerLine {
  if (!lastTickAt) {
    return {
      tone: "warn",
      title: "Scheduler not running",
      detail: "No tick yet. Posts wait until it runs.",
    };
  }
  const age = now.getTime() - lastTickAt.getTime();
  if (age <= SCHEDULER_STALE_MS) {
    return {
      tone: "good",
      title: "Scheduler running",
      detail: `Checked at ${clockTime(lastTickAt, timezone)}`,
    };
  }
  return {
    tone: "warn",
    title: `Scheduler: last tick ${ageLabel(age)} ago`,
    detail: "Posts wait until it runs again.",
  };
}
