import type { NoteBox } from "./notes";
import { frameAt } from "./notes";

/**
 * The Versions tab player (BC-37, pure): timecodes, frame steps and note boxes from pointer
 * positions. Browser seeking isn't frame-exact, so the page stores the time and the version's
 * fps; the session extracts the exact frame from its own render.
 */

export const DEFAULT_FPS = 30;

/** `mm:ss.ff` (frames within the second, at the version's fps). */
export function timecode(tS: number, fps: number = DEFAULT_FPS): string {
  const rate = fps > 0 ? fps : DEFAULT_FPS;
  const frame = frameAt(Math.max(0, tS), rate);
  const perSecond = Math.round(rate);
  const totalS = Math.floor(frame / rate + 1e-9);
  const ff = frame - Math.round(totalS * rate);
  const mm = Math.floor(totalS / 60);
  const ss = totalS % 60;
  const pad = (n: number) => String(Math.max(0, Math.min(n, 99))).padStart(2, "0");
  return `${pad(mm)}:${pad(ss)}.${String(Math.min(ff, perSecond - 1)).padStart(2, "0")}`;
}

/**
 * The time `delta` frames from `tS`, clamped to [0, duration]. Lands in the middle of the target
 * frame so a browser seek shows that frame, not the one before.
 */
export function stepFrame(
  tS: number,
  fps: number,
  delta: number,
  durationS?: number | null,
): number {
  const rate = fps > 0 ? fps : DEFAULT_FPS;
  const lastFrame =
    durationS && durationS > 0 ? Math.max(0, Math.ceil(durationS * rate) - 1) : Infinity;
  const target = Math.max(0, Math.min(lastFrame, frameAt(tS, rate) + delta));
  return Math.round(((target + 0.5) / rate) * 1000) / 1000;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Below this share of the frame, a drag counts as a click (a moment note). */
export const DRAG_MIN = 0.02;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** A point on the frame, normalised 0–1 from the top left (clamped to the frame). */
export function normalise(p: Point, rect: Rect): Point {
  if (!(rect.width > 0) || !(rect.height > 0)) return { x: 0, y: 0 };
  return {
    x: clamp01((p.x - rect.left) / rect.width),
    y: clamp01((p.y - rect.top) / rect.height),
  };
}

/**
 * What a pointer gesture on the paused frame means: a click is a moment note, a drag a region
 * note with its box normalised 0–1 (whichever way it was dragged).
 */
export function gestureNote(
  start: Point,
  end: Point,
  rect: Rect,
): { kind: "moment" } | { kind: "region"; box: NoteBox } {
  const a = normalise(start, rect);
  const b = normalise(end, rect);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (w < DRAG_MIN || h < DRAG_MIN) return { kind: "moment" };
  return {
    kind: "region",
    box: {
      x: round4(Math.min(a.x, b.x)),
      y: round4(Math.min(a.y, b.y)),
      w: round4(w),
      h: round4(h),
    },
  };
}

/** The crop of a box in a frame of `width` × `height` pixels (whole pixels, inside the frame). */
export function cropRect(
  box: NoteBox | null,
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (!box) return { sx: 0, sy: 0, sw: width, sh: height };
  const sx = Math.max(0, Math.floor(box.x * width));
  const sy = Math.max(0, Math.floor(box.y * height));
  return {
    sx,
    sy,
    sw: Math.max(1, Math.min(width - sx, Math.round(box.w * width))),
    sh: Math.max(1, Math.min(height - sy, Math.round(box.h * height))),
  };
}

/** Crops are JPEGs at most 1280 px wide. */
export function cropSize(sw: number, sh: number, maxW = 1280): { w: number; h: number } {
  const scale = sw > maxW ? maxW / sw : 1;
  return { w: Math.max(1, Math.round(sw * scale)), h: Math.max(1, Math.round(sh * scale)) };
}
