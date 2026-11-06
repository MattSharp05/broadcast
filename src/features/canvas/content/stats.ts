import type { PageStat } from "@/components/PageHeader";
import type { CanvasStats } from "@/lib/domain/canvas";
import { inFrom } from "@/lib/domain/format";
import type { CanvasLayout } from "./layout";

/**
 * The Workflow top bar: "13 scheduled | Next post in 9 h 46 min | 9 posted today | 1 failed".
 * With `onFailed`, a non-zero failed count is a button (BC-20: it pans to the first failed card).
 */
export function workflowStats(stats: CanvasStats, now: Date, onFailed?: () => void): PageStat[] {
  const next = stats.nextAt && stats.nextAt > now ? inFrom(stats.nextAt, now) : "none";
  return [
    { value: stats.scheduled, label: "scheduled" },
    { value: next, label: "Next post", labelFirst: true },
    { value: stats.postedToday, label: "posted today" },
    {
      value: stats.failed,
      label: "failed",
      ...(stats.failed > 0 ? { tone: "bad" as const } : {}),
      ...(stats.failed > 0 && onFailed
        ? { onClick: onFailed, title: "Show the first failed post" }
        : {}),
    },
  ];
}

/** Where the first failed card sits (its id and centre), or null when the layout has none. */
export function firstFailedCard(layout: CanvasLayout): { id: string; x: number; y: number } | null {
  for (const col of layout.columns) {
    for (const { item, rect } of col.posted) {
      if (item.kind !== "failed") continue;
      return { id: item.id, x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 };
    }
  }
  return null;
}
