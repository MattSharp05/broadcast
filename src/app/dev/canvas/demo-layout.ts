import type { MinimapItem, Rect } from "@/features/canvas/engine";

/** Geometry from docs/DESIGN.md → Workflow canvas. */
export const COLUMNS = 6;
export const COLUMN_GAP = 372;
export const CARD_W = 256;
export const CARD_H = 104;
export const ROW_GAP = 40;
export const DEFAULT_BOXES = 48;
export const MAX_BOXES = 600;

export type BoxKind = "header" | "upcoming" | "posted";

export interface DemoBox {
  id: string;
  label: string;
  kind: BoxKind;
  rect: Rect;
}

export function parseBoxCount(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  return Math.min(MAX_BOXES, Math.max(COLUMNS, Number(raw)));
}

/**
 * Lays out `count` boxes round-robin over six columns: each column's first box is its header,
 * centred on the now line (y = 0); then boxes alternate above (upcoming, nearest first) and
 * below (posted, newest first).
 */
export function layoutBoxes(count: number): DemoBox[] {
  const boxes: DemoBox[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % COLUMNS;
    const idx = Math.floor(i / COLUMNS);
    const x0 = col * COLUMN_GAP;
    let kind: BoxKind;
    let y0: number;
    let label: string;
    if (idx === 0) {
      kind = "header";
      y0 = -CARD_H / 2;
      label = `Account ${col + 1}`;
    } else if (idx % 2 === 1) {
      const k = (idx - 1) / 2;
      kind = "upcoming";
      y0 = -CARD_H / 2 - (k + 1) * (CARD_H + ROW_GAP);
      label = `Account ${col + 1}, upcoming ${k + 1}`;
    } else {
      const k = idx / 2 - 1;
      kind = "posted";
      y0 = CARD_H / 2 + ROW_GAP + k * (CARD_H + ROW_GAP);
      label = `Account ${col + 1}, posted ${k + 1}`;
    }
    boxes.push({
      id: `c${col + 1}-${idx}`,
      label,
      kind,
      rect: { x0, y0, x1: x0 + CARD_W, y1: y0 + CARD_H },
    });
  }
  return boxes;
}

export function minimapItems(boxes: readonly DemoBox[]): MinimapItem[] {
  return boxes.map((b) => ({ rect: b.rect, tone: b.kind === "upcoming" ? "accent" : "neutral" }));
}
