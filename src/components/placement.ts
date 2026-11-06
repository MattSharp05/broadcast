/** Where a floating panel goes next to an anchor, without covering it. Pure; used by Popover. */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placement {
  left: number;
  top: number;
  side: "right" | "left" | "below" | "above";
}

export interface PlaceOptions {
  /** Space between the anchor and the panel. */
  gap?: number;
  /** Minimum space between the panel and the viewport edge. */
  margin?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, Math.max(lo, hi)));
}

/**
 * Right of the anchor, else left, else below, else above (top-aligned with the anchor and kept
 * inside the viewport). Only when none of those fit does the panel overlap the anchor.
 */
export function placeBeside(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  { gap = 10, margin = 8 }: PlaceOptions = {},
): Placement {
  const { width: w, height: h } = size;
  const vTop = clamp(anchor.top, margin, viewport.height - h - margin);
  const hLeft = clamp(anchor.left, margin, viewport.width - w - margin);

  const right = anchor.right + gap;
  if (right + w <= viewport.width - margin) return { left: right, top: vTop, side: "right" };
  const left = anchor.left - gap - w;
  if (left >= margin) return { left, top: vTop, side: "left" };
  const below = anchor.bottom + gap;
  if (below + h <= viewport.height - margin) return { left: hLeft, top: below, side: "below" };
  const above = anchor.top - gap - h;
  if (above >= margin) return { left: hLeft, top: above, side: "above" };
  return { left: clamp(right, margin, viewport.width - w - margin), top: vTop, side: "right" };
}
