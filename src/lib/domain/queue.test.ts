import { describe, expect, it } from "vitest";
import { openSlots, planQueue, type PlannerPost, type QueueInput } from "@/lib/domain/queue";

const NY = "America/New_York";
const SLOTS = ["09:00", "13:00", "19:00"];
/** Tuesday 10 Nov 2026, 12:00 in New York (EST, UTC−5). */
const NOON = new Date("2026-11-10T17:00:00Z");

function queued(id: string, queuePosition?: number, status: PlannerPost["status"] = "queued") {
  return { id, timing: "queue", queuePosition, status } satisfies PlannerPost;
}

function pinned(id: string, iso: string, status: PlannerPost["status"] = "queued") {
  return { id, timing: "pinned", scheduledAt: new Date(iso), status } satisfies PlannerPost;
}

function plan(input: Partial<QueueInput> & Pick<QueueInput, "posts">) {
  return planQueue({ slots: SLOTS, timezone: NY, now: NOON, ...input }).map(
    ({ id, scheduledAt }) => [id, scheduledAt?.toISOString() ?? null],
  );
}

describe("planQueue", () => {
  it("fills the next free slots in order: 13:00 today, 19:00 today, 09:00 tomorrow", () => {
    expect(plan({ posts: [queued("a", 1), queued("b", 2), queued("c", 3)] })).toEqual([
      ["a", "2026-11-10T18:00:00.000Z"],
      ["b", "2026-11-11T00:00:00.000Z"],
      ["c", "2026-11-11T14:00:00.000Z"],
    ]);
  });

  it("lets a pinned post at 19:00 take that slot; queued posts skip it", () => {
    const posts = [
      queued("a", 1),
      pinned("pin", "2026-11-11T00:00:00Z"),
      queued("b", 2),
      queued("c", 3),
    ];
    expect(plan({ posts })).toEqual([
      ["a", "2026-11-10T18:00:00.000Z"],
      ["b", "2026-11-11T14:00:00.000Z"],
      ["c", "2026-11-11T18:00:00.000Z"],
    ]);
  });

  it("matches a pin to a slot at minute precision", () => {
    const posts = [pinned("pin", "2026-11-10T18:00:30Z"), queued("a", 1)];
    expect(plan({ posts })).toEqual([["a", "2026-11-11T00:00:00.000Z"]]);
  });

  it("doesn't give a slot to a pin between slots", () => {
    const posts = [pinned("pin", "2026-11-10T20:00:00Z"), queued("a", 1)];
    expect(plan({ posts })).toEqual([["a", "2026-11-10T18:00:00.000Z"]]);
  });

  it("frees the slot of a pin that is published, failed, removed or has no time", () => {
    const posts: PlannerPost[] = [
      pinned("p1", "2026-11-10T18:00:00Z", "published"),
      pinned("p2", "2026-11-10T18:00:00Z", "failed"),
      pinned("p3", "2026-11-10T18:00:00Z", "removed"),
      { id: "p4", timing: "pinned", scheduledAt: null, status: "queued" },
      queued("a", 1),
    ];
    expect(plan({ posts })).toEqual([["a", "2026-11-10T18:00:00.000Z"]]);
  });

  it("keeps the slot of a paused pin and of a post already publishing", () => {
    const posts: PlannerPost[] = [
      pinned("pin", "2026-11-10T18:00:00Z", "paused"),
      {
        id: "pub",
        timing: "queue",
        scheduledAt: new Date("2026-11-11T00:00:00Z"),
        status: "publishing",
      },
      queued("a", 1),
    ];
    expect(plan({ posts })).toEqual([["a", "2026-11-11T14:00:00.000Z"]]);
  });

  it("times queued and paused queue posts only", () => {
    const posts = [
      queued("done", 1, "published"),
      queued("bad", 2, "failed"),
      queued("gone", 3, "removed"),
      queued("pausedOne", 4, "paused"),
      queued("a", 5),
    ];
    expect(plan({ posts })).toEqual([
      ["pausedOne", "2026-11-10T18:00:00.000Z"],
      ["a", "2026-11-11T00:00:00.000Z"],
    ]);
  });

  it("reorders the times when queuePosition is reordered", () => {
    expect(plan({ posts: [queued("a", 2), queued("b", 3), queued("c", 1)] })).toEqual([
      ["c", "2026-11-10T18:00:00.000Z"],
      ["a", "2026-11-11T00:00:00.000Z"],
      ["b", "2026-11-11T14:00:00.000Z"],
    ]);
  });

  it("moves later posts up when a post is removed", () => {
    expect(plan({ posts: [queued("a", 1), queued("c", 3)] })).toEqual([
      ["a", "2026-11-10T18:00:00.000Z"],
      ["c", "2026-11-11T00:00:00.000Z"],
    ]);
  });

  it("puts posts without a queuePosition last and breaks ties by input order", () => {
    const posts = [queued("none"), queued("x", 1), queued("y", 1)];
    expect(plan({ posts }).map(([id]) => id)).toEqual(["x", "y", "none"]);
  });

  it("skips slots at or before now + 1 min", () => {
    const at = (iso: string) => plan({ now: new Date(iso), posts: [queued("a", 1)] })[0];
    expect(at("2026-11-10T17:59:00Z")).toEqual(["a", "2026-11-11T00:00:00.000Z"]);
    expect(at("2026-11-10T17:58:59Z")).toEqual(["a", "2026-11-10T18:00:00.000Z"]);
  });

  it("starts from the workspace's local date, not UTC's", () => {
    // 03:00 UTC on 11 Nov = 22:00 on 10 Nov in New York → next slot is 09:00 on 11 Nov.
    const result = plan({ now: new Date("2026-11-11T03:00:00Z"), posts: [queued("a", 1)] });
    expect(result).toEqual([["a", "2026-11-11T14:00:00.000Z"]]);
  });

  it("accepts slots in any order and ignores duplicates", () => {
    const result = plan({
      slots: ["19:00", "13:00", "13:00"],
      posts: [queued("a", 1), queued("b", 2)],
    });
    expect(result).toEqual([
      ["a", "2026-11-10T18:00:00.000Z"],
      ["b", "2026-11-11T00:00:00.000Z"],
    ]);
  });

  it("gives every queue post scheduledAt null when no slots are configured", () => {
    expect(
      plan({ slots: [], posts: [queued("a", 1), pinned("pin", "2026-11-11T00:00:00Z")] }),
    ).toEqual([["a", null]]);
  });

  it("returns nothing for an empty backlog", () => {
    expect(plan({ posts: [] })).toEqual([]);
  });

  it("throws for an invalid slot or timezone", () => {
    expect(() => plan({ slots: ["9:00"], posts: [] })).toThrow(RangeError);
    expect(() => plan({ timezone: "Nowhere/City", posts: [queued("a", 1)] })).toThrow(RangeError);
  });

  describe("across DST changes (America/New_York)", () => {
    it("keeps a 09:00 slot at 09:00 local over the fall-back change on 1 Nov 2026", () => {
      // Friday 30 Oct 2026, 10:00 EDT.
      const now = new Date("2026-10-30T14:00:00Z");
      const result = plan({
        slots: ["09:00"],
        now,
        posts: [queued("a", 1), queued("b", 2), queued("c", 3)],
      });
      expect(result).toEqual([
        ["a", "2026-10-31T13:00:00.000Z"], // 09:00 EDT
        ["b", "2026-11-01T14:00:00.000Z"], // 09:00 EST
        ["c", "2026-11-02T14:00:00.000Z"], // 09:00 EST
      ]);
    });

    it("uses the first 01:30 on the fall-back day", () => {
      const now = new Date("2026-11-01T04:00:00Z"); // 00:00 EDT
      expect(plan({ slots: ["01:30"], now, posts: [queued("a", 1)] })).toEqual([
        ["a", "2026-11-01T05:30:00.000Z"], // 01:30 EDT
      ]);
    });

    it("moves a 02:30 slot to 03:30 EDT on the spring-forward day (8 Mar 2026)", () => {
      const now = new Date("2026-03-08T05:00:00Z"); // 00:00 EST
      const result = plan({ slots: ["02:30"], now, posts: [queued("a", 1), queued("b", 2)] });
      expect(result).toEqual([
        ["a", "2026-03-08T07:30:00.000Z"], // 03:30 EDT
        ["b", "2026-03-09T06:30:00.000Z"], // 02:30 EDT
      ]);
    });

    it("keeps slots in time order and merges slots that collide in the gap", () => {
      const now = new Date("2026-03-08T05:00:00Z");
      const posts = [queued("a", 1), queued("b", 2), queued("c", 3)];
      // 02:30 → 03:30 EDT, which comes after 03:00 and is the same instant as the 03:30 slot.
      expect(plan({ slots: ["02:30", "03:00", "03:30"], now, posts })).toEqual([
        ["a", "2026-03-08T07:00:00.000Z"],
        ["b", "2026-03-08T07:30:00.000Z"],
        ["c", "2026-03-09T06:30:00.000Z"],
      ]);
    });
  });
});

describe("openSlots", () => {
  const iso = (dates: Date[]) => dates.map((d) => d.toISOString());

  it("returns the next N slots not taken by planned or pinned posts", () => {
    const posts = [queued("a", 1), pinned("pin", "2026-11-11T14:00:00Z"), queued("b", 2)];
    const result = openSlots({ slots: SLOTS, timezone: NY, now: NOON, posts, count: 3 });
    expect(iso(result)).toEqual([
      "2026-11-11T18:00:00.000Z",
      "2026-11-12T00:00:00.000Z",
      "2026-11-12T14:00:00.000Z",
    ]);
  });

  it("returns the next slots straight away for an empty backlog", () => {
    const result = openSlots({ slots: SLOTS, timezone: NY, now: NOON, posts: [], count: 2 });
    expect(iso(result)).toEqual(["2026-11-10T18:00:00.000Z", "2026-11-11T00:00:00.000Z"]);
  });

  it("returns nothing with no slots or a count of 0", () => {
    const base = { timezone: NY, now: NOON, posts: [queued("a", 1)] };
    expect(openSlots({ ...base, slots: [], count: 3 })).toEqual([]);
    expect(openSlots({ ...base, slots: SLOTS, count: 0 })).toEqual([]);
    expect(openSlots({ ...base, slots: SLOTS, count: -2 })).toEqual([]);
  });
});
