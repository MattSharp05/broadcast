import type { PageStat } from "@/components/PageHeader";
import type { CanvasStats } from "@/lib/domain/canvas";
import { inFrom } from "@/lib/domain/format";

/** The Workflow top bar: "13 scheduled | Next post in 9 h 46 min | 9 posted today | 1 failed". */
export function workflowStats(stats: CanvasStats, now: Date): PageStat[] {
  const next = stats.nextAt && stats.nextAt > now ? inFrom(stats.nextAt, now) : "none";
  return [
    { value: stats.scheduled, label: "scheduled" },
    { value: next, label: "Next post", labelFirst: true },
    { value: stats.postedToday, label: "posted today" },
    { value: stats.failed, label: "failed", ...(stats.failed > 0 ? { tone: "bad" as const } : {}) },
  ];
}
