import { describe, expect, it } from "vitest";
import {
  BACK,
  backlogOrder,
  mediaRules,
  moveProblem,
  movedMessage,
  positionChanges,
  reorder,
  slotPlacement,
  undoPlacement,
  type QueueRow,
} from "./move";

const NOW = new Date("2026-11-05T22:14:00Z");
const TZ = "Europe/London";
const READY = { status: "ready", slots: ["09:00", "13:00"], platform: "fake" };

describe("moveProblem", () => {
  const base = {
    status: "queued" as const,
    sourcePlatform: "fake",
    target: READY,
    placement: { kind: "back" as const },
    now: NOW,
  };

  it("accepts a waiting post going to a ready account with slots", () => {
    expect(moveProblem(base)).toBeNull();
    expect(moveProblem({ ...base, status: "paused" })).toBeNull();
    expect(moveProblem({ ...base, sourcePlatform: "instagram" })).toBeNull();
  });

  it("refuses posts that aren't waiting", () => {
    expect(moveProblem({ ...base, status: "publishing" })).toBe("not_editable");
    expect(moveProblem({ ...base, status: "published" })).toBe("not_editable");
    expect(moveProblem({ ...base, status: "failed" })).toBe("not_editable");
  });

  it("refuses accounts that can't post", () => {
    expect(moveProblem({ ...base, target: null })).toBe("unknown_account");
    expect(moveProblem({ ...base, target: { ...READY, status: "needs_attention" } })).toBe(
      "target_not_ready",
    );
    expect(moveProblem({ ...base, target: { ...READY, slots: [] } })).toBe("target_no_slots");
    expect(moveProblem({ ...base, target: { ...READY, platform: "tiktok" } })).toBe(
      "other_platform",
    );
  });

  it("refuses slots and pins in the past", () => {
    expect(moveProblem({ ...base, placement: { kind: "slot", at: NOW } })).toBe("slot_past");
    expect(
      moveProblem({ ...base, placement: { kind: "pinned", at: new Date("2026-11-05T20:00:00Z") } }),
    ).toBe("slot_past");
    expect(moveProblem({ ...base, placement: { kind: "slot", at: new Date("nope") } })).toBe(
      "slot_past",
    );
    expect(
      moveProblem({ ...base, placement: { kind: "slot", at: new Date("2026-11-06T09:00:00Z") } }),
    ).toBeNull();
  });
});

describe("mediaRules", () => {
  it("treats the fake provider like Instagram", () => {
    expect(mediaRules("fake")).toBe(mediaRules("instagram"));
    expect(mediaRules("tiktok")).not.toBe(mediaRules("instagram"));
  });
});

const row = (
  id: string,
  queuePosition: number | null,
  extra: Partial<QueueRow> = {},
): QueueRow => ({
  id,
  timing: "queue",
  queuePosition,
  scheduledAt: null,
  status: "queued",
  ...extra,
});

describe("backlogOrder", () => {
  it("keeps waiting queue posts in position order", () => {
    const rows = [
      row("c", 3),
      row("p", 1, { timing: "pinned", scheduledAt: NOW }),
      row("a", 0),
      row("x", 2, { status: "publishing" }),
      row("b", 1, { status: "paused" }),
    ];
    expect(backlogOrder(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("reorder", () => {
  const backlog = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("moves within the backlog", () => {
    expect(reorder(backlog, "a", "b")).toEqual(["b", "a", "c"]);
    expect(reorder(backlog, "a", "c")).toEqual(["b", "c", "a"]);
    expect(reorder(backlog, "c", null)).toEqual(["c", "a", "b"]);
    expect(reorder(backlog, "a", BACK)).toEqual(["b", "c", "a"]);
  });
  it("inserts a post from elsewhere", () => {
    expect(reorder(backlog, "z", "a")).toEqual(["a", "z", "b", "c"]);
  });
  it("is null when the post to follow has left", () => {
    expect(reorder(backlog, "a", "gone")).toBeNull();
  });
});

describe("positionChanges", () => {
  it("writes only the moved post when it fits between its neighbours", () => {
    const current = new Map<string, number | null>([
      ["a", 0],
      ["b", 2],
      ["z", 7],
    ]);
    expect(positionChanges(["a", "z", "b"], current, "z")).toEqual([{ id: "z", queuePosition: 1 }]);
    expect(positionChanges(["z", "a", "b"], current, "z")).toEqual([
      { id: "z", queuePosition: -1 },
    ]);
    expect(positionChanges(["a", "b", "z"], current, "z")).toEqual([{ id: "z", queuePosition: 3 }]);
    expect(positionChanges(["z"], new Map([["z", 5]]), "z")).toEqual([
      { id: "z", queuePosition: 0 },
    ]);
  });

  it("renumbers the backlog when there's no room", () => {
    const current = new Map<string, number | null>([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
    expect(positionChanges(["b", "a", "c"], current, "a")).toEqual([
      { id: "b", queuePosition: 0 },
      { id: "a", queuePosition: 1 },
    ]);
  });

  it("never takes a position another post of the account keeps", () => {
    const current = new Map<string, number | null>([
      ["a", 1],
      ["b", 4],
      ["z", 9],
    ]);
    // Published posts keep 0, 2 and 3.
    const taken = new Set([0, 2, 3]);
    expect(positionChanges(["z", "a", "b"], current, "z", taken)).toEqual([
      { id: "z", queuePosition: -1 },
    ]);
    // No free position between a (1) and b (4): renumbered around the kept ones.
    expect(positionChanges(["a", "z", "b"], current, "z", taken)).toEqual([
      { id: "z", queuePosition: 4 },
      { id: "b", queuePosition: 5 },
    ]);
    expect(positionChanges(["a", "b", "z"], current, "z", new Set([5, 6]))).toEqual([
      { id: "z", queuePosition: 7 },
    ]);
    expect(positionChanges(["z"], new Map([["z", 5]]), "z", new Set([0, 1]))).toEqual([
      { id: "z", queuePosition: 2 },
    ]);
    // Renumbering skips the kept positions: 1, 4, 5.
    const full = new Map<string, number | null>([
      ["a", 1],
      ["b", 4],
      ["c", 5],
    ]);
    expect(positionChanges(["b", "a", "c"], full, "a", new Set([0, 2, 3]))).toEqual([
      { id: "b", queuePosition: 1 },
      { id: "a", queuePosition: 4 },
    ]);
  });
});

describe("slotPlacement", () => {
  // Thu 5 Nov 22:14 London; slots 09:00 and 13:00. Backlog a, b → Fri 09:00, Fri 13:00.
  const rows = [row("a", 0), row("b", 1)];
  const input = { rows, slots: ["09:00", "13:00"], timezone: TZ, now: NOW };

  it("joins the back of the queue when the back gets that slot", () => {
    // Another account's post: the back is Sat 09:00.
    expect(slotPlacement({ ...input, movedId: "z", at: new Date("2026-11-07T09:00:00Z") })).toBe(
      "back",
    );
    // The account's own first post: the back after it moves is Fri 13:00.
    expect(slotPlacement({ ...input, movedId: "a", at: new Date("2026-11-06T13:00:00Z") })).toBe(
      "back",
    );
  });

  it("pins to a later open slot", () => {
    expect(slotPlacement({ ...input, movedId: "z", at: new Date("2026-11-07T13:00:00Z") })).toBe(
      "pinned",
    );
  });
});

describe("undoPlacement", () => {
  const backlog = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("puts a queue post back after the post before it", () => {
    const post = { timing: "queue" as const, scheduledAt: null };
    expect(undoPlacement({ ...post, id: "b" }, backlog)).toEqual({ kind: "queue", after: "a" });
    expect(undoPlacement({ ...post, id: "a" }, backlog)).toEqual({ kind: "queue", after: null });
    expect(undoPlacement({ ...post, id: "z" }, backlog)).toEqual({ kind: "back" });
  });
  it("re-pins a pinned post", () => {
    const at = new Date("2026-11-06T16:30:00Z");
    expect(undoPlacement({ id: "p", timing: "pinned", scheduledAt: at }, backlog)).toEqual({
      kind: "pinned",
      at,
    });
  });
});

describe("movedMessage", () => {
  it("names the account and the new time", () => {
    expect(movedMessage("trip.app", new Date("2026-11-06T13:00:00Z"), NOW, TZ)).toBe(
      "Moved to @trip.app, Tomorrow, 13:00.",
    );
    expect(movedMessage("trip.app", null, NOW, TZ)).toMatch(/waits in the backlog/);
  });
});
