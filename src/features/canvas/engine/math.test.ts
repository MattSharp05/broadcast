import { describe, expect, it } from "vitest";
import {
  FIT_MAX_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  NOW_MARGIN,
  NOW_MARGIN_NARROW,
  applyWheel,
  centerOn,
  clampScale,
  easeOut,
  fitBounds,
  formatZoom,
  initialView,
  lerpView,
  minimapToWorld,
  minimapTransform,
  nowView,
  panBy,
  parseView,
  pinchView,
  rectContains,
  screenToWorld,
  unionRects,
  visibleWorldRect,
  worldToMinimap,
  worldToScreen,
  zoomAt,
  zoomLevel,
  type View,
  type WheelInput,
} from "./math";

const close = (a: number, b: number) => {
  expect(a).toBeCloseTo(b, 6);
};
const wheel = (w: Partial<WheelInput>): WheelInput => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...w,
});

describe("world ↔ screen", () => {
  it("round-trips a point", () => {
    const v: View = { x: 120, y: -40, s: 0.75 };
    const p = { x: 333, y: -77 };
    const back = screenToWorld(v, worldToScreen(v, p));
    close(back.x, p.x);
    close(back.y, p.y);
  });
});

describe("clampScale and zoomLevel", () => {
  it("clamps to 0.28–1.8", () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(5)).toBe(MAX_SCALE);
    expect(clampScale(1)).toBe(1);
    expect([MIN_SCALE, MAX_SCALE]).toEqual([0.28, 1.8]);
  });

  it("is far below 0.6 and near from 0.6", () => {
    expect(zoomLevel(0.59)).toBe("far");
    expect(zoomLevel(0.6)).toBe("near");
    expect(zoomLevel(1.8)).toBe("near");
  });
});

describe("zoomAt", () => {
  it.each([
    [{ x: 0, y: 0, s: 1 }, { x: 400, y: 300 }, 1.5],
    [{ x: -250, y: 90, s: 0.4 }, { x: 17, y: 610 }, 0.9],
    [{ x: 33, y: 44, s: 1.7 }, { x: 800, y: 1 }, 0.3],
  ])("keeps the world point under the pointer (%o at %o → %d)", (view, at, scale) => {
    const before = screenToWorld(view, at);
    const next = zoomAt(view, at, scale);
    const after = screenToWorld(next, at);
    close(next.s, scale);
    close(after.x, before.x);
    close(after.y, before.y);
  });

  it("clamps the scale and still keeps the point fixed", () => {
    const view = { x: 10, y: 20, s: 1 };
    const at = { x: 300, y: 200 };
    const next = zoomAt(view, at, 10);
    expect(next.s).toBe(MAX_SCALE);
    const w = screenToWorld(next, at);
    const w0 = screenToWorld(view, at);
    close(w.x, w0.x);
    close(w.y, w0.y);
    expect(zoomAt(view, at, 0.01).s).toBe(MIN_SCALE);
  });
});

describe("panBy", () => {
  it("moves the world by the screen delta and keeps the scale", () => {
    expect(panBy({ x: 5, y: 6, s: 0.5 }, 30, -12)).toEqual({ x: 35, y: -6, s: 0.5 });
  });
});

describe("pinchView", () => {
  const start: View = { x: 100, y: 50, s: 1 };
  const startMid = { x: 400, y: 300 };

  it("scales by the finger distance ratio around a still midpoint", () => {
    const v = pinchView(start, startMid, 100, startMid, 150);
    close(v.s, 1.5);
    const w = screenToWorld(v, startMid);
    const w0 = screenToWorld(start, startMid);
    close(w.x, w0.x);
    close(w.y, w0.y);
  });

  it("pans with the midpoint", () => {
    const v = pinchView(start, startMid, 100, { x: 430, y: 280 }, 100);
    expect(v).toEqual({ x: 130, y: 30, s: 1 });
  });

  it("clamps and survives a zero start distance", () => {
    expect(pinchView(start, startMid, 100, startMid, 10_000).s).toBe(MAX_SCALE);
    expect(pinchView(start, startMid, 0, startMid, 50).s).toBe(1);
  });
});

describe("fitBounds", () => {
  const viewport = { w: 1200, h: 700 };

  it("contains the bounds with 30px padding on every side", () => {
    const bounds = { x0: -200, y0: -900, x1: 2000, y1: 1100 };
    const v = fitBounds(bounds, viewport);
    const tl = worldToScreen(v, { x: bounds.x0, y: bounds.y0 });
    const br = worldToScreen(v, { x: bounds.x1, y: bounds.y1 });
    expect(tl.x).toBeGreaterThanOrEqual(30 - 1e-6);
    expect(tl.y).toBeGreaterThanOrEqual(30 - 1e-6);
    expect(br.x).toBeLessThanOrEqual(viewport.w - 30 + 1e-6);
    expect(br.y).toBeLessThanOrEqual(viewport.h - 30 + 1e-6);
    // Tight on the limiting axis (height here): exactly 30px top and bottom.
    close(tl.y, 30);
    close(br.y, viewport.h - 30);
    // Centred on the other axis.
    close(tl.x, viewport.w - br.x);
    expect(rectContains(visibleWorldRect(v, viewport), bounds)).toBe(true);
  });

  it("is tight on width when the bounds are wide", () => {
    const v = fitBounds({ x0: 0, y0: 0, x1: 3000, y1: 100 }, viewport);
    close(v.s, (1200 - 60) / 3000);
    close(worldToScreen(v, { x: 0, y: 0 }).x, 30);
  });

  it("never enlarges small content beyond the fit maximum", () => {
    const v = fitBounds({ x0: 0, y0: 0, x1: 100, y1: 100 }, viewport);
    expect(v.s).toBe(FIT_MAX_SCALE);
    const c = worldToScreen(v, { x: 50, y: 50 });
    close(c.x, 600);
    close(c.y, 350);
  });

  it("stops at the minimum scale for huge content", () => {
    expect(fitBounds({ x0: 0, y0: 0, x1: 100_000, y1: 10 }, viewport).s).toBe(MIN_SCALE);
  });
});

describe("centerOn, nowView, initialView", () => {
  it("centres a world point and keeps the scale", () => {
    const v = centerOn({ x: 0, y: 0, s: 0.5 }, { x: 1000, y: -200 }, { w: 800, h: 600 });
    expect(v.s).toBe(0.5);
    const c = worldToScreen(v, { x: 1000, y: -200 });
    close(c.x, 400);
    close(c.y, 300);
  });

  it("puts the now anchor at the left margin, vertically centred", () => {
    const anchor = { x: -40, y: 0 };
    const v = nowView({ x: 999, y: 999, s: 0.8 }, anchor, { w: 1200, h: 700 });
    const p = worldToScreen(v, anchor);
    expect(v.s).toBe(0.8);
    close(p.x, NOW_MARGIN);
    close(p.y, 350);
    const n = worldToScreen(nowView(v, anchor, { w: 390, h: 700 }), anchor);
    close(n.x, NOW_MARGIN_NARROW);
  });

  it("starts at 100% (72% on narrow stages)", () => {
    expect(initialView({ x: 0, y: 0 }, { w: 1200, h: 700 }).s).toBe(1);
    expect(initialView({ x: 0, y: 0 }, { w: 390, h: 700 }).s).toBe(0.72);
  });
});

describe("visibleWorldRect and unionRects", () => {
  it("returns the world area on screen", () => {
    expect(visibleWorldRect({ x: -100, y: 50, s: 2 }, { w: 400, h: 300 })).toEqual({
      x0: 50,
      y0: -25,
      x1: 250,
      y1: 125,
    });
  });

  it("unions rectangles (null when empty)", () => {
    expect(unionRects([])).toBeNull();
    expect(
      unionRects([
        { x0: 0, y0: 5, x1: 10, y1: 6 },
        { x0: -3, y0: 7, x1: 4, y1: 20 },
      ]),
    ).toEqual({ x0: -3, y0: 5, x1: 10, y1: 20 });
  });
});

describe("minimap", () => {
  const bounds = { x0: -100, y0: -500, x1: 2100, y1: 700 };
  const m = minimapTransform(bounds, { w: 190, h: 116 }, 8);

  it("fits the bounds inside the map with padding, centred", () => {
    const tl = worldToMinimap(m, { x: bounds.x0, y: bounds.y0 });
    const br = worldToMinimap(m, { x: bounds.x1, y: bounds.y1 });
    close(tl.x, 8);
    close(br.x, 182);
    expect(tl.y).toBeGreaterThanOrEqual(8);
    expect(br.y).toBeLessThanOrEqual(108);
    close(tl.y, 116 - br.y);
  });

  it("maps back to world points", () => {
    const p = { x: 777, y: -123 };
    const back = minimapToWorld(m, worldToMinimap(m, p));
    close(back.x, p.x);
    close(back.y, p.y);
  });

  it("clicking the map centre centres the bounds", () => {
    const world = minimapToWorld(m, { x: 95, y: 58 });
    close(world.x, 1000);
    close(world.y, 100);
  });
});

describe("applyWheel", () => {
  const view: View = { x: 0, y: 0, s: 1 };
  const at = { x: 200, y: 100 };
  const vp = { w: 800, h: 600 };

  it("pans with a plain wheel / trackpad scroll", () => {
    expect(applyWheel(view, wheel({ deltaX: 10, deltaY: 30 }), at, vp)).toEqual({
      x: -10,
      y: -30,
      s: 1,
    });
  });

  it("scrolls sideways with shift + wheel", () => {
    expect(applyWheel(view, wheel({ deltaY: 40, shiftKey: true }), at, vp)).toEqual({
      x: -40,
      y: 0,
      s: 1,
    });
  });

  it("converts line and page deltas to pixels", () => {
    expect(applyWheel(view, wheel({ deltaY: 3, deltaMode: 1 }), at, vp).y).toBe(-48);
    expect(applyWheel(view, wheel({ deltaY: 1, deltaMode: 2 }), at, vp).y).toBe(-600);
  });

  it.each(["ctrlKey", "metaKey"] as const)("zooms around the pointer with %s", (key) => {
    const zin = applyWheel(view, wheel({ deltaY: -50, [key]: true }), at, vp);
    expect(zin.s).toBeGreaterThan(1);
    const w = screenToWorld(zin, at);
    close(w.x, 200);
    close(w.y, 100);
    expect(applyWheel(view, wheel({ deltaY: 50, [key]: true }), at, vp).s).toBeLessThan(1);
  });

  it("limits one coarse wheel step", () => {
    const v = applyWheel({ x: 0, y: 0, s: 0.5 }, wheel({ deltaY: -1000, ctrlKey: true }), at, vp);
    close(v.s, 0.5 * Math.exp(0.7));
  });
});

describe("lerpView and easeOut", () => {
  it("interpolates and clamps t", () => {
    const a = { x: 0, y: 0, s: 1 };
    const b = { x: 100, y: -50, s: 0.5 };
    expect(lerpView(a, b, 0.5)).toEqual({ x: 50, y: -25, s: 0.75 });
    expect(lerpView(a, b, 2)).toEqual(b);
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

describe("parseView", () => {
  it("accepts a valid stored view", () => {
    expect(parseView('{"x":1,"y":-2,"s":0.5}')).toEqual({ x: 1, y: -2, s: 0.5 });
  });

  it.each([
    null,
    "",
    "nope",
    "null",
    "[]",
    '{"x":1,"y":2}',
    '{"x":"1","y":2,"s":1}',
    '{"x":1,"y":2,"s":9}',
  ])("rejects %s", (raw) => {
    expect(parseView(raw)).toBeNull();
  });
});

describe("formatZoom", () => {
  it("rounds to a whole percent", () => {
    expect(formatZoom(1)).toBe("100%");
    expect(formatZoom(0.284)).toBe("28%");
  });
});
