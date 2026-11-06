import { describe, expect, it } from "vitest";
import type { CanvasColumn, UpcomingCard } from "@/lib/domain/canvas";
import { CARD_H, CARD_W, COL, upTop, layoutCanvas } from "../layout";
import { dropTargets, gapY, hitTarget, type DropTarget } from "./targets";

const t0 = new Date("2026-11-06T09:00:00Z");
const card = (id: string, kind: UpcomingCard["kind"], h = 0): UpcomingCard => {
  const at = new Date(t0.getTime() + h * 3_600_000);
  return kind === "open"
    ? { kind, id, at }
    : { kind, id, at, title: id, durationS: 30, thumbnailUrl: null };
};

function column(id: string, upcoming: UpcomingCard[]): CanvasColumn {
  return {
    id,
    handle: id,
    brand: "B",
    platform: "fake",
    tags: [],
    status: "ready",
    statusReason: null,
    followers: 0,
    backlog: upcoming.length,
    profileUrl: "",
    avatar: 1,
    upcoming,
    moreInBacklog: 0,
    posted: [],
    next: { kind: "none" },
  };
}

// Like canvas-busy: cj has q0, q1, a pin, q2; trip has q0, q1 and two open slots.
const cj = column("cj", [
  card("q0", "scheduled", 0),
  card("q1", "scheduled", 4),
  card("pin", "pinned", 10),
  card("q2", "scheduled", 24),
]);
const trip = column("trip", [
  card("t0", "scheduled", 3),
  card("t1", "scheduled", 9),
  card("open1", "open", 27),
  card("open2", "open", 33),
]);
const layout = layoutCanvas([cj, trip]);
const all = () => true;

const describeTarget = (t: DropTarget) =>
  t.kind === "gap" ? `${t.accountId} after ${t.after ?? "front"}` : `${t.accountId} slot`;

describe("dropTargets", () => {
  it("offers the gaps between cards and the open slots, minus no-op places", () => {
    expect(dropTargets(layout, "q0", all).map(describeTarget)).toEqual([
      // Gap 0 (before q0) and gap 1 (after q0) are where q0 already is.
      "cj after q1", // between q1 and the pin
      "cj after q1", // between the pin and q2: still after q1 in the backlog
      "cj after q2", // above q2
      "trip after front",
      "trip after t0",
      "trip slot",
      "trip slot",
    ]);
  });

  it("offers every gap for a pinned card (dropping it in the queue unpins it)", () => {
    const own = dropTargets(layout, "pin", all).filter((t) => t.accountId === "cj");
    expect(own.map(describeTarget)).toEqual([
      "cj after front",
      "cj after q0",
      "cj after q1",
      "cj after q1",
      "cj after q2",
    ]);
  });

  it("leaves out columns that can't take the post", () => {
    const targets = dropTargets(layout, "q0", (id) => id === "cj");
    expect(targets.every((t) => t.accountId === "cj")).toBe(true);
  });

  it("places gaps between the cards", () => {
    expect(gapY(0)).toBeLessThan(-52);
    expect(gapY(0)).toBeGreaterThan(upTop(0) + CARD_H);
    expect(gapY(2)).toBeLessThan(upTop(1));
    expect(gapY(2)).toBeGreaterThan(upTop(2) + CARD_H);
  });
});

describe("hitTarget", () => {
  const targets = dropTargets(layout, "q0", all);
  const x = CARD_W / 2;

  it("picks the nearest gap from the card's halves", () => {
    // Upper half of the pin (row 2): the gap above it (between the pin and q2).
    const pinTop = upTop(2);
    expect(hitTarget(targets, { x, y: pinTop + 10 })?.key).toBe("gap:cj:3");
    // Lower half of the pin: the gap below it (after q1).
    expect(hitTarget(targets, { x, y: pinTop + CARD_H - 10 })?.key).toBe("gap:cj:2");
  });

  it("finds nothing over the card's own place", () => {
    expect(hitTarget(targets, { x, y: upTop(0) + CARD_H / 2 })).toBeNull();
  });

  it("catches open slots, and the space between columns", () => {
    const slot = hitTarget(targets, { x: COL - 20, y: upTop(2) + 20 });
    expect(slot?.kind).toBe("slot");
    expect(hitTarget(targets, { x, y: 200 })).toBeNull();
  });
});
