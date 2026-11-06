/**
 * Pure maths for the canvas engine (no DOM, no I/O). A view maps world → screen:
 * screen = world * s + (x, y), with the transform origin at the stage's top-left.
 */

export interface View {
  /** Screen x of world x = 0, in px. */
  x: number;
  /** Screen y of world y = 0, in px. */
  y: number;
  /** Scale (1 = 100%). */
  s: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** An axis-aligned rectangle by its edges (x0 ≤ x1, y0 ≤ y1). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const MIN_SCALE = 0.28;
export const MAX_SCALE = 1.8;
/** "Fit all" never enlarges small content beyond this. */
export const FIT_MAX_SCALE = 1.2;
/** Space left around the bounds by "Fit all", in screen px. */
export const FIT_PADDING = 30;
/** Below this scale the content switches to its far (semantic zoom) rendering. */
export const FAR_BELOW = 0.6;
/** A pointer must move this far (px) before a press becomes a pan; shorter presses stay clicks. */
export const DRAG_THRESHOLD = 4;
/** Zoom-in/out buttons multiply or divide the scale by this. */
export const ZOOM_STEP = 1.2;
/** "Back to now" puts the now anchor this far from the stage's left edge (narrow stages: less). */
export const NOW_MARGIN = 56;
export const NOW_MARGIN_NARROW = 24;
/** Stages narrower than this count as narrow (phones). */
export const NARROW_BELOW = 700;
/** Initial scale when there is no stored view. */
export const START_SCALE = 1;
export const START_SCALE_NARROW = 0.72;

export type ZoomLevel = "near" | "far";

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function clampScale(s: number): number {
  return clamp(s, MIN_SCALE, MAX_SCALE);
}

export function zoomLevel(s: number): ZoomLevel {
  return s < FAR_BELOW ? "far" : "near";
}

export function worldToScreen(view: View, p: Point): Point {
  return { x: p.x * view.s + view.x, y: p.y * view.s + view.y };
}

export function screenToWorld(view: View, p: Point): Point {
  return { x: (p.x - view.x) / view.s, y: (p.y - view.y) / view.s };
}

/** Zooms to `scale` (clamped) keeping the world point under the screen point `at` fixed. */
export function zoomAt(view: View, at: Point, scale: number): View {
  const s = clampScale(scale);
  const k = s / view.s;
  return { x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k, s };
}

/** Moves the world by a screen-space delta from a starting view (drag to pan). */
export function panBy(view: View, dx: number, dy: number): View {
  return { x: view.x + dx, y: view.y + dy, s: view.s };
}

/**
 * Two-finger pinch: from the view at the start of the gesture, scale by the ratio of finger
 * distances and keep the world point under the starting midpoint under the current midpoint
 * (so a pinch also pans).
 */
export function pinchView(
  start: View,
  startMid: Point,
  startDist: number,
  mid: Point,
  dist: number,
): View {
  const s = clampScale(start.s * (startDist > 0 ? dist / startDist : 1));
  const anchor = screenToWorld(start, startMid);
  return { x: mid.x - anchor.x * s, y: mid.y - anchor.y * s, s };
}

/**
 * Scale and position that show the whole of `bounds` centred in the viewport with `padding`
 * screen px on every side, never above FIT_MAX_SCALE and never outside the zoom range.
 */
export function fitBounds(bounds: Rect, viewport: Size, padding = FIT_PADDING): View {
  const w = Math.max(1, bounds.x1 - bounds.x0);
  const h = Math.max(1, bounds.y1 - bounds.y0);
  const availW = Math.max(1, viewport.w - 2 * padding);
  const availH = Math.max(1, viewport.h - 2 * padding);
  const s = clamp(Math.min(availW / w, availH / h, FIT_MAX_SCALE), MIN_SCALE, MAX_SCALE);
  return {
    x: (viewport.w - w * s) / 2 - bounds.x0 * s,
    y: (viewport.h - h * s) / 2 - bounds.y0 * s,
    s,
  };
}

/** Keeps the scale and moves the view so `world` sits at the centre of the viewport. */
export function centerOn(view: View, world: Point, viewport: Size): View {
  return { x: viewport.w / 2 - world.x * view.s, y: viewport.h / 2 - world.y * view.s, s: view.s };
}

export function isNarrow(viewport: Size): boolean {
  return viewport.w < NARROW_BELOW;
}

/**
 * "Back to now": keeps the scale and puts the now anchor (a world point, e.g. the left end of
 * the now line) at the left margin, vertically centred.
 */
export function nowView(view: View, nowAnchor: Point, viewport: Size): View {
  const margin = isNarrow(viewport) ? NOW_MARGIN_NARROW : NOW_MARGIN;
  return { x: margin - nowAnchor.x * view.s, y: viewport.h / 2 - nowAnchor.y * view.s, s: view.s };
}

/** The first view when nothing is stored: "Back to now" at the start scale. */
export function initialView(nowAnchor: Point, viewport: Size): View {
  const s = isNarrow(viewport) ? START_SCALE_NARROW : START_SCALE;
  return nowView({ x: 0, y: 0, s }, nowAnchor, viewport);
}

/** The world rectangle currently visible in the viewport. */
export function visibleWorldRect(view: View, viewport: Size): Rect {
  const a = screenToWorld(view, { x: 0, y: 0 });
  const b = screenToWorld(view, { x: viewport.w, y: viewport.h });
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x0);
    y0 = Math.min(y0, r.y0);
    x1 = Math.max(x1, r.x1);
    y1 = Math.max(y1, r.y1);
  }
  return { x0, y0, x1, y1 };
}

export function rectContains(outer: Rect, inner: Rect, eps = 1e-6): boolean {
  return (
    inner.x0 >= outer.x0 - eps &&
    inner.y0 >= outer.y0 - eps &&
    inner.x1 <= outer.x1 + eps &&
    inner.y1 <= outer.y1 + eps
  );
}

/** How world `bounds` map into a minimap of `size` px with `padding`: map = (world - origin) * s + offset. */
export interface MinimapTransform {
  s: number;
  ox: number;
  oy: number;
  bounds: Rect;
}

export function minimapTransform(bounds: Rect, size: Size, padding: number): MinimapTransform {
  const bw = Math.max(1, bounds.x1 - bounds.x0);
  const bh = Math.max(1, bounds.y1 - bounds.y0);
  const s = Math.min((size.w - 2 * padding) / bw, (size.h - 2 * padding) / bh);
  return {
    s,
    ox: padding + (size.w - 2 * padding - bw * s) / 2,
    oy: padding + (size.h - 2 * padding - bh * s) / 2,
    bounds,
  };
}

export function worldToMinimap(m: MinimapTransform, p: Point): Point {
  return { x: m.ox + (p.x - m.bounds.x0) * m.s, y: m.oy + (p.y - m.bounds.y0) * m.s };
}

export function minimapToWorld(m: MinimapTransform, p: Point): Point {
  return { x: m.bounds.x0 + (p.x - m.ox) / m.s, y: m.bounds.y0 + (p.y - m.oy) / m.s };
}

/** Pixels per wheel "line" and the DOM's WheelEvent.deltaMode values. */
const LINE_PX = 16;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Zoom speed: scale multiplies by exp(-deltaY * this) for ctrl/cmd + wheel and trackpad pinch. */
export const WHEEL_ZOOM_SPEED = 0.01;

/**
 * Applies one wheel event: ctrl/cmd + wheel (and trackpad pinch, which browsers report as
 * ctrl + wheel) zooms around the pointer; shift + wheel scrolls sideways; otherwise the wheel or
 * two-finger trackpad scroll pans.
 */
export function applyWheel(view: View, e: WheelInput, at: Point, viewport: Size): View {
  const unit =
    e.deltaMode === DOM_DELTA_LINE ? LINE_PX : e.deltaMode === DOM_DELTA_PAGE ? viewport.h : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  if (e.ctrlKey || e.metaKey) {
    // Clamp one event's effect so a coarse mouse wheel step doesn't jump (±~2x at most).
    const step = clamp(dy, -70, 70);
    return zoomAt(view, at, view.s * Math.exp(-step * WHEEL_ZOOM_SPEED));
  }
  if (e.shiftKey && dx === 0) return panBy(view, -dy, 0);
  return panBy(view, -dx, -dy);
}

/** Linear interpolation between two views (t in 0..1), for short animated moves. */
export function lerpView(a: View, b: View, t: number): View {
  const k = clamp(t, 0, 1);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, s: a.s + (b.s - a.s) * k };
}

/** Ease-out cubic for animated moves. */
export function easeOut(t: number): number {
  const k = 1 - clamp(t, 0, 1);
  return 1 - k * k * k;
}

/** Parses a stored view, rejecting anything malformed or outside the zoom range. */
export function parseView(raw: string | null): View | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { x, y, s } = v as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number" || typeof s !== "number") return null;
    if (![x, y, s].every(Number.isFinite)) return null;
    if (s < MIN_SCALE || s > MAX_SCALE) return null;
    return { x, y, s };
  } catch {
    return null;
  }
}

export function formatZoom(s: number): string {
  return `${Math.round(s * 100)}%`;
}
