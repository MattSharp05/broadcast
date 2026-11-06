import { describe, expect, it } from "vitest";
import { placeBeside } from "./placement";

const VIEW = { width: 1000, height: 800 };
const SIZE = { width: 272, height: 200 };
const card = (left: number, top: number, w = 256, h = 104) => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

function overlaps(a: ReturnType<typeof card>, p: { left: number; top: number }) {
  return !(
    p.left >= a.right ||
    p.left + SIZE.width <= a.left ||
    p.top >= a.bottom ||
    p.top + SIZE.height <= a.top
  );
}

describe("placeBeside", () => {
  it("goes right of the anchor, top-aligned", () => {
    expect(placeBeside(card(100, 300), SIZE, VIEW)).toEqual({ left: 366, top: 300, side: "right" });
  });

  it("flips left near the right edge and stays inside the viewport vertically", () => {
    const p = placeBeside(card(700, 700), SIZE, VIEW);
    expect(p.side).toBe("left");
    expect(p.left).toBe(700 - 10 - 272);
    expect(p.top).toBe(800 - 200 - 8);
  });

  it("goes below or above when neither side has room, never covering the anchor", () => {
    const wide = card(50, 100, 900, 104);
    const below = placeBeside(wide, SIZE, VIEW);
    expect(below.side).toBe("below");
    expect(overlaps(wide, below)).toBe(false);
    const low = card(50, 600, 900, 104);
    const above = placeBeside(low, SIZE, VIEW);
    expect(above.side).toBe("above");
    expect(overlaps(low, above)).toBe(false);
  });
});
