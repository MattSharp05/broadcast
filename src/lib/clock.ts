import type { WorkspaceKind } from "@/lib/db/workspaces";

/**
 * The clock. Code asks `nowFor(workspace)` instead of calling `new Date()`, so the Sandbox can run
 * on a fixed time (`?now=ISO`, stored in settings.clock_override) while Live always uses real time.
 */
export interface ClockedWorkspace {
  kind: WorkspaceKind;
  /** ISO timestamp the Sandbox clock is frozen at, or null for real time. Ignored for Live. */
  clockOverride: string | null;
}

export function nowFor(workspace: ClockedWorkspace, realNow: Date = new Date()): Date {
  if (workspace.kind === "sandbox" && workspace.clockOverride) {
    const fixed = new Date(workspace.clockOverride);
    if (!Number.isNaN(fixed.getTime())) return fixed;
  }
  return realNow;
}

/** Earliest and latest accepted `?now=` (keeps typos like year 20026 out). */
const MIN_NOW = Date.UTC(2000, 0, 1);
const MAX_NOW = Date.UTC(2100, 0, 1);

/**
 * Parses a `?now=` value: an ISO 8601 date-time with a zone (`2026-11-05T22:14:00Z`,
 * `2026-11-05T22:14+01:00`). Returns null for anything else.
 */
export function parseNowParam(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return null;
  }
  const date = new Date(value);
  const t = date.getTime();
  if (Number.isNaN(t) || t < MIN_NOW || t > MAX_NOW) return null;
  return date;
}

/** Drops seconds and milliseconds. */
export function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}
