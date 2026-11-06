import { describe, expect, it } from "vitest";
import {
  CARD_H,
  COLUMNS,
  MAX_BOXES,
  layoutBoxes,
  minimapItems,
  parseBoxCount,
} from "./demo-layout";

const overlaps = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe("parseBoxCount", () => {
  it("accepts digits and clamps", () => {
    expect(parseBoxCount("200")).toBe(200);
    expect(parseBoxCount("1")).toBe(COLUMNS);
    expect(parseBoxCount("99999")).toBe(MAX_BOXES);
  });

  it.each([undefined, "", "abc", "-5", "2.5"])("ignores %s", (raw) => {
    expect(parseBoxCount(raw)).toBeNull();
  });
});

describe("layoutBoxes", () => {
  it("lays out six columns with headers on the now line and no overlaps", () => {
    const boxes = layoutBoxes(200);
    expect(boxes).toHaveLength(200);
    expect(new Set(boxes.map((b) => b.id)).size).toBe(200);
    const headers = boxes.filter((b) => b.kind === "header");
    expect(headers).toHaveLength(COLUMNS);
    for (const h of headers) expect(h.rect.y0).toBe(-CARD_H / 2);
    for (const b of boxes) {
      if (b.kind === "upcoming") expect(b.rect.y1).toBeLessThan(0);
      if (b.kind === "posted") expect(b.rect.y0).toBeGreaterThan(0);
    }
    boxes.forEach((a, i) => {
      for (const b of boxes.slice(i + 1)) expect(overlaps(a.rect, b.rect)).toBe(false);
    });
  });

  it("colours upcoming boxes with the accent on the minimap", () => {
    const tones = minimapItems(layoutBoxes(18)).map((m) => m.tone);
    expect(tones.slice(0, 6)).toEqual(Array(6).fill("neutral"));
    expect(tones.slice(6, 12)).toEqual(Array(6).fill("accent"));
  });
});
