import type { Point, Rect } from "@/features/canvas/engine";
import type { UpcomingCard } from "@/lib/domain/canvas";
import { CARD_H, CARD_W, COL, GAP, HEADER_H, upTop, type CanvasLayout } from "../layout";

/**
 * Where a dragged card can land (BC-22): the gaps between waiting cards and the open slots in
 * every column that can take a post. Pure (world geometry from ./layout), so it's unit tested.
 */

export type DropTarget =
  | {
      kind: "gap";
      key: string;
      accountId: string;
      handle: string;
      /** The queue post it goes after (null: the front of the queue). */
      after: string | null;
      /** Centre line of the gap. */
      y: number;
      rect: Rect;
    }
  | {
      kind: "slot";
      key: string;
      accountId: string;
      handle: string;
      at: Date;
      rect: Rect;
    };

/** Card kinds that can be dragged: waiting posts the scheduler hasn't picked up. */
export const DRAGGABLE_KINDS: ReadonlySet<string> = new Set(["scheduled", "pinned"]);

/** Highlight thickness of a gap. */
const GAP_LINE = 6;
/** A gap catches the pointer this far above and below its line (half a card and half a gap). */
const GAP_REACH = (CARD_H + GAP) / 2;
/** Columns catch the pointer across the space between them. */
const SIDE = (COL - CARD_W) / 2;

/** A queue post (its order in the backlog is the order of these cards). */
function isQueuePost(c: UpcomingCard): boolean {
  return c.kind === "scheduled" || c.kind === "paused";
}

/** The centre line of gap g: between upcoming row g − 1 (below) and row g (above). */
export function gapY(g: number): number {
  return g === 0 ? -HEADER_H / 2 - GAP / 2 : upTop(g - 1) - GAP / 2;
}

/**
 * Every drop target for dragging `cardId`. `accepts(accountId)` says which columns can take a
 * post (ready, with slots, same media rules). Places that wouldn't change anything (the gaps right
 * around a queued card in its own column) aren't targets.
 */
export function dropTargets(
  layout: CanvasLayout,
  cardId: string,
  accepts: (accountId: string) => boolean,
): DropTarget[] {
  const out: DropTarget[] = [];
  for (const col of layout.columns) {
    const { column } = col;
    if (!accepts(column.id)) continue;
    const rows = col.upcoming.map((p) => p.item);
    const own = rows.findIndex((r) => r.id === cardId);
    // Where the card sits now in its own backlog: after this queue post.
    let currentAfter: string | null | undefined;
    if (own >= 0 && rows[own]?.kind === "scheduled") {
      currentAfter = null;
      for (let k = 0; k < own; k++) {
        const r = rows[k];
        if (r && isQueuePost(r)) currentAfter = r.id;
      }
    }

    for (let g = 0; g <= rows.length; g++) {
      const below = g > 0 ? rows[g - 1] : undefined;
      const above = rows[g];
      // Gaps sit between post cards (and below the first and above the last one); next to an
      // open slot, the slot itself is the target.
      if (below?.kind === "open" || above?.kind === "open") continue;
      let after: string | null = null;
      for (let k = 0; k < g; k++) {
        const r = rows[k];
        if (r && r.id !== cardId && isQueuePost(r)) after = r.id;
      }
      if (currentAfter !== undefined && after === currentAfter) continue;
      const y = gapY(g);
      out.push({
        kind: "gap",
        key: `gap:${column.id}:${g}`,
        accountId: column.id,
        handle: column.handle,
        after,
        y,
        rect: { x0: col.x, y0: y - GAP_LINE / 2, x1: col.x + CARD_W, y1: y + GAP_LINE / 2 },
      });
    }
    for (const { item, rect } of col.upcoming) {
      if (item.kind !== "open") continue;
      out.push({
        kind: "slot",
        key: `slot:${column.id}:${item.at.toISOString()}`,
        accountId: column.id,
        handle: column.handle,
        at: item.at,
        rect,
      });
    }
  }
  return out;
}

/** The target under a world point: an open slot it's over, else the nearest gap in reach. */
export function hitTarget(targets: readonly DropTarget[], p: Point): DropTarget | null {
  let best: DropTarget | null = null;
  let bestDy = Infinity;
  for (const t of targets) {
    if (p.x < t.rect.x0 - SIDE || p.x > t.rect.x1 + SIDE) continue;
    if (t.kind === "slot") {
      if (p.y >= t.rect.y0 - GAP / 2 && p.y <= t.rect.y1 + GAP / 2) return t;
      continue;
    }
    const dy = Math.abs(p.y - t.y);
    if (dy <= GAP_REACH && dy < bestDy) {
      best = t;
      bestDy = dy;
    }
  }
  return best;
}
