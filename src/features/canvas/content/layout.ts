import type { MinimapItem, Point, Rect } from "@/features/canvas/engine";
import type { CanvasColumn, PostedCard, UpcomingCard } from "@/lib/domain/canvas";

/**
 * World geometry of the Workflow canvas (docs/DESIGN.md → Layout → Workflow canvas). The now line
 * is y = 0; column i starts at x = i × COL. Pure, so it's unit tested.
 */
export const COL = 372;
export const CARD_W = 256;
export const HEADER_H = 104;
export const CARD_H = 104;
export const GAP = 40;
/** Left edge of the now tag and the lane labels (left of the first column). */
export const LEFT = -250;
/** The band and now line run this far past the content on both sides. */
export const BAND_OVERHANG = 40;
/** The band extends this far above and below the headers. */
export const BAND_PAD = 14;
/** On narrow screens "Back to now" skips most of the lane labels so the first column shows. */
export const NARROW_SKIP = 190;
const MORE_H = 28;
const TAIL = 30;

/** Top edge of the k-th upcoming card (k = 0 nearest the line). */
export function upTop(k: number): number {
  return -HEADER_H / 2 - GAP - (k + 1) * CARD_H - k * GAP;
}

/** Top edge of the k-th posted card (k = 0 newest, nearest the line). */
export function pastTop(k: number): number {
  return HEADER_H / 2 + GAP + k * (CARD_H + GAP);
}

export interface Placed<T> {
  item: T;
  rect: Rect;
}

export interface ArrowPath {
  d: string;
  /** Dashed: the backlog link and the tail below the last posted card. */
  ghost: boolean;
}

export interface ColumnLayout {
  column: CanvasColumn;
  x: number;
  header: Rect;
  /** Centre of the countdown chip, in the gap right of the column. */
  chip: Point;
  upcoming: Placed<UpcomingCard>[];
  posted: Placed<PostedCard>[];
  /** "N more in backlog" above the top card. */
  more: Rect | null;
}

export interface CanvasLayout {
  columns: ColumnLayout[];
  arrows: ArrowPath[];
  band: Rect;
  /** Left end of the now line; also where the now tag sits. */
  nowLeft: number;
  nowRight: number;
  upcomingLane: Point;
  postedLane: Point;
  bounds: Rect;
  minimap: MinimapItem[];
}

function rect(x: number, y: number, w: number, h: number): Rect {
  return { x0: x, y0: y, x1: x + w, y1: y + h };
}

/** A straight arrow pointing down from y1 to y2 (nothing when the gap is too small). */
function arrow(x: number, y1: number, y2: number): ArrowPath[] {
  if (y2 - y1 < 8) return [];
  return [
    {
      d: `M${x} ${y1} V${y2} M${x - 4.5} ${y2 - 5.5} L${x} ${y2} L${x + 4.5} ${y2 - 5.5}`,
      ghost: false,
    },
  ];
}

function upcomingTone(c: UpcomingCard): MinimapItem["tone"] {
  if (c.kind === "open") return "muted";
  if (c.kind === "paused") return "warn";
  return "accent";
}

export function layoutCanvas(columns: readonly CanvasColumn[]): CanvasLayout {
  const width = Math.max(1, columns.length) * COL;
  const arrows: ArrowPath[] = [];
  const minimap: MinimapItem[] = [];
  const nowLeft = LEFT - BAND_OVERHANG;
  const nowRight = width + BAND_OVERHANG;

  minimap.push({ rect: { x0: nowLeft, y0: -1, x1: nowRight, y1: 1 }, tone: "strong" });

  const laid = columns.map((column, i): ColumnLayout => {
    const x = i * COL;
    const cx = x + CARD_W / 2;
    const header = rect(x, -HEADER_H / 2, CARD_W, HEADER_H);
    minimap.push({ rect: header, tone: column.status === "ready" ? "neutral" : "warn" });

    const upcoming = column.upcoming.map((item, k) => {
      const r = rect(x, upTop(k), CARD_W, CARD_H);
      minimap.push({ rect: r, tone: upcomingTone(item) });
      return { item, rect: r };
    });
    const posted = column.posted.map((item, k) => {
      const r = rect(x, pastTop(k), CARD_W, CARD_H);
      minimap.push({ rect: r, tone: item.kind === "failed" ? "bad" : "neutral" });
      return { item, rect: r };
    });

    let more: Rect | null = null;
    const n = upcoming.length;
    if (n > 0) {
      arrows.push(...arrow(cx, upTop(0) + CARD_H + 3, -HEADER_H / 2 - 4));
      for (let k = n - 1; k > 0; k--)
        arrows.push(...arrow(cx, upTop(k) + CARD_H + 3, upTop(k - 1) - 4));
      if (column.moreInBacklog > 0) {
        const yy = upTop(n);
        more = rect(x, yy + CARD_H - MORE_H - 6, CARD_W, MORE_H);
        arrows.push({ d: `M${cx} ${yy + CARD_H - 6} V${upTop(n - 1) - 4}`, ghost: true });
      }
    }
    if (posted.length > 0) {
      arrows.push(...arrow(cx, HEADER_H / 2 + 3, pastTop(0) - 4));
      for (let k = 1; k < posted.length; k++)
        arrows.push(...arrow(cx, pastTop(k - 1) + CARD_H + 3, pastTop(k) - 4));
      const yl = pastTop(posted.length - 1) + CARD_H + 3;
      arrows.push({ d: `M${cx} ${yl} V${yl + TAIL}`, ghost: true });
    }

    return {
      column,
      x,
      header,
      chip: { x: x + CARD_W + (COL - CARD_W) / 2, y: 0 },
      upcoming,
      posted,
      more,
    };
  });

  const maxUp = Math.max(
    1,
    ...columns.map((c) => c.upcoming.length + (c.moreInBacklog > 0 ? 1 : 0)),
  );
  const maxPast = Math.max(1, ...columns.map((c) => c.posted.length));
  const bounds: Rect = {
    x0: LEFT - 30,
    y0: upTop(maxUp - 1) - 70,
    x1: width,
    y1: pastTop(maxPast - 1) + CARD_H + 60,
  };

  return {
    columns: laid,
    arrows,
    band: { x0: nowLeft, y0: -HEADER_H / 2 - BAND_PAD, x1: nowRight, y1: HEADER_H / 2 + BAND_PAD },
    nowLeft,
    nowRight,
    upcomingLane: { x: LEFT, y: -HEADER_H / 2 - GAP - CARD_H * 1.5 },
    postedLane: { x: LEFT, y: HEADER_H / 2 + GAP + 8 },
    bounds,
    minimap,
  };
}

/** Where "Back to now" puts the left margin: the now tag, or past the lane labels when narrow. */
export function nowAnchor(narrow: boolean): Point {
  return { x: narrow ? LEFT + NARROW_SKIP : LEFT, y: 0 };
}
