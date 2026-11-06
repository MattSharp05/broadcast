import { describe, expect, it } from "vitest";
import type { CanvasColumn, PostedCard, UpcomingCard } from "@/lib/domain/canvas";
import {
  CARD_H,
  CARD_W,
  COL,
  GAP,
  HEADER_H,
  LEFT,
  layoutCanvas,
  nowAnchor,
  pastTop,
  upTop,
} from "./layout";

const at = new Date("2026-11-06T09:00:00Z");
const up = (id: string, kind: UpcomingCard["kind"] = "scheduled"): UpcomingCard =>
  kind === "open"
    ? { kind, id, at }
    : { kind, id, at, title: id, durationS: 30, thumbnailUrl: null };
const posted = (id: string): PostedCard => ({
  kind: "posted",
  id,
  at,
  title: id,
  durationS: 30,
  thumbnailUrl: null,
  views: 1,
  likes: 1,
  comments: 0,
});

function column(id: string, nUp: number, nPast: number, more = 0): CanvasColumn {
  return {
    id,
    handle: id,
    brand: "B",
    platform: "fake",
    tags: [],
    status: "ready",
    statusReason: null,
    followers: 0,
    backlog: nUp + more,
    profileUrl: "",
    avatar: 1,
    upcoming: Array.from({ length: nUp }, (_, k) => up(`${id}-u${k}`)),
    moreInBacklog: more,
    posted: Array.from({ length: nPast }, (_, k) => posted(`${id}-p${k}`)),
    next: { kind: "none" },
  };
}

describe("canvas layout", () => {
  it("uses the DESIGN.md geometry: 372px columns, 256px cards, 104px rows, 40px gaps", () => {
    const l = layoutCanvas([column("a", 2, 2), column("b", 1, 0)]);
    expect(l.columns.map((c) => c.x)).toEqual([0, COL]);
    expect(l.columns[0]?.header).toEqual({ x0: 0, y0: -52, x1: CARD_W, y1: 52 });
    // Next post nearest the line, 40px above the header; posted 40px below.
    expect(l.columns[0]?.upcoming[0]?.rect.y1).toBe(-HEADER_H / 2 - GAP);
    expect(upTop(1) + CARD_H).toBe(upTop(0) - GAP);
    expect(l.columns[0]?.posted[0]?.rect.y0).toBe(HEADER_H / 2 + GAP);
    expect(pastTop(1)).toBe(pastTop(0) + CARD_H + GAP);
    // The chip is centred in the gap right of the column.
    expect(l.columns[1]?.chip).toEqual({ x: COL + CARD_W + (COL - CARD_W) / 2, y: 0 });
  });

  it("draws one arrow per consecutive pair plus the tail and backlog links", () => {
    const l = layoutCanvas([column("a", 3, 2, 5)]);
    const solid = l.arrows.filter((a) => !a.ghost);
    const ghost = l.arrows.filter((a) => a.ghost);
    // 3 upcoming → 3 arrows (incl. into the header); header → 2 posted → 2 arrows.
    expect(solid).toHaveLength(5);
    // The backlog link above and the dashed tail below.
    expect(ghost).toHaveLength(2);
    expect(l.columns[0]?.more).not.toBeNull();
  });

  it("has no arrows or tail for an empty column", () => {
    const l = layoutCanvas([column("a", 0, 0)]);
    expect(l.arrows).toEqual([]);
    expect(l.columns[0]?.more).toBeNull();
  });

  it("bounds cover every card, the band and the lane labels", () => {
    const l = layoutCanvas([column("a", 4, 5, 2), column("b", 1, 1)]);
    const rects = [
      ...l.columns.flatMap((c) => [
        c.header,
        ...c.upcoming.map((u) => u.rect),
        ...c.posted.map((p) => p.rect),
      ]),
    ];
    for (const r of rects) {
      expect(r.x0).toBeGreaterThanOrEqual(l.bounds.x0);
      expect(r.x1).toBeLessThanOrEqual(l.bounds.x1);
      expect(r.y0).toBeGreaterThanOrEqual(l.bounds.y0);
      expect(r.y1).toBeLessThanOrEqual(l.bounds.y1);
    }
    expect(l.bounds.x0).toBeLessThan(LEFT);
    expect(l.minimap.length).toBe(1 + rects.length);
  });

  it("anchors 'Back to now' at the now tag, or past the lanes when narrow", () => {
    expect(nowAnchor(false)).toEqual({ x: LEFT, y: 0 });
    expect(nowAnchor(true).x).toBeGreaterThan(LEFT);
  });
});
