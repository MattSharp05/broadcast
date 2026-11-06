import { describe, expect, it } from "vitest";
import {
  addedMessage,
  firstTime,
  localInputToUtc,
  newPostStatus,
  nextOpenSlot,
  nextQueuePosition,
  timeChanges,
  timingProblem,
  utcToLocalInput,
  type ExistingPost,
} from "./content";

const LONDON = "Europe/London";
// Thu 5 Nov 2026, 22:14 in London (GMT).
const NOW = new Date("2026-11-05T22:14:00Z");
const SLOTS = ["09:00", "13:00", "19:00"];
const at = (iso: string) => new Date(iso);

function queued(id: string, position: number, scheduledAt: string | null): ExistingPost {
  return {
    id,
    timing: "queue",
    queuePosition: position,
    scheduledAt: scheduledAt ? at(scheduledAt) : null,
    status: "queued",
  };
}

describe("nextQueuePosition", () => {
  it("goes after every post, published ones included", () => {
    expect(nextQueuePosition([])).toBe(0);
    expect(
      nextQueuePosition([{ queuePosition: 0 }, { queuePosition: 7 }, { queuePosition: null }]),
    ).toBe(8);
  });
});

describe("newPostStatus", () => {
  it("queues on ready accounts and pauses on the others", () => {
    expect(newPostStatus("ready")).toBe("queued");
    expect(newPostStatus("needs_attention")).toBe("paused");
    expect(newPostStatus("not_connected")).toBe("paused");
  });
});

describe("timeChanges", () => {
  const existing = [queued("a", 0, "2026-11-06T09:00:00Z"), queued("b", 1, "2026-11-06T13:00:00Z")];

  it("times a new queue post at the first open slot and leaves the others", () => {
    const posts = [...existing, queued("new", 2, null)];
    expect(timeChanges({ slots: SLOTS, timezone: LONDON, now: NOW, posts })).toEqual([
      { id: "new", scheduledAt: at("2026-11-06T19:00:00Z") },
    ]);
  });

  it("a pin between slots changes nothing; a pin on a slot pushes the queue back", () => {
    const off: ExistingPost = {
      id: "pin",
      timing: "pinned",
      scheduledAt: at("2026-11-06T15:30:00Z"),
      status: "queued",
    };
    expect(
      timeChanges({ slots: SLOTS, timezone: LONDON, now: NOW, posts: [...existing, off] }),
    ).toEqual([]);
    const on = { ...off, scheduledAt: at("2026-11-06T09:00:00Z") };
    expect(
      timeChanges({ slots: SLOTS, timezone: LONDON, now: NOW, posts: [...existing, on] }),
    ).toEqual([
      { id: "a", scheduledAt: at("2026-11-06T13:00:00Z") },
      { id: "b", scheduledAt: at("2026-11-06T19:00:00Z") },
    ]);
  });

  it("with no slots the new post waits without a time", () => {
    expect(
      timeChanges({ slots: [], timezone: LONDON, now: NOW, posts: [queued("new", 0, null)] }),
    ).toEqual([]);
  });
});

describe("nextOpenSlot", () => {
  it("is the slot after the backlog, or null without slots", () => {
    const posts = [queued("a", 0, null), queued("b", 1, null)];
    expect(nextOpenSlot({ slots: SLOTS, timezone: LONDON, now: NOW, posts })).toEqual(
      at("2026-11-06T19:00:00Z"),
    );
    expect(nextOpenSlot({ slots: [], timezone: LONDON, now: NOW, posts })).toBeNull();
  });
});

describe("timing", () => {
  it("rejects past and invalid pins", () => {
    expect(timingProblem({ kind: "queue" }, NOW)).toBeNull();
    expect(timingProblem({ kind: "pinned", at: at("2026-11-06T12:00:00Z") }, NOW)).toBeNull();
    expect(timingProblem({ kind: "pinned", at: NOW }, NOW)).toBe("pinned_past");
    expect(timingProblem({ kind: "pinned", at: new Date(Number.NaN) }, NOW)).toBe("pinned_invalid");
  });

  it("reads datetime-local values in the workspace timezone, both ways", () => {
    expect(localInputToUtc("2026-11-07T12:00", LONDON)).toEqual(at("2026-11-07T12:00:00Z"));
    expect(localInputToUtc("2026-07-07T12:00", LONDON)).toEqual(at("2026-07-07T11:00:00Z"));
    expect(localInputToUtc("2026-07-07T12:00", "America/New_York")).toEqual(
      at("2026-07-07T16:00:00Z"),
    );
    expect(localInputToUtc("tomorrow", LONDON)).toBeNull();
    expect(localInputToUtc("2026-13-07T12:00", LONDON)).toBeNull();
    expect(utcToLocalInput(at("2026-07-07T11:00:00Z"), LONDON)).toBe("2026-07-07T12:00");
    expect(utcToLocalInput(NOW, LONDON)).toBe("2026-11-05T22:14");
  });
});

describe("the toast", () => {
  it("says how many queues and when the first post goes out", () => {
    const first = firstTime([null, at("2026-11-06T19:00:00Z"), at("2026-11-06T13:00:00Z")]);
    expect(addedMessage(2, first, NOW, LONDON)).toBe(
      "Added to 2 queues. First post Tomorrow, 13:00.",
    );
    expect(addedMessage(1, null, NOW, LONDON)).toBe(
      "Added to 1 queue. It waits in the backlog until a slot opens.",
    );
    expect(firstTime([])).toBeNull();
  });
});
