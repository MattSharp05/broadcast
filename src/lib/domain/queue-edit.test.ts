import { describe, expect, it } from "vitest";
import { MAX_CAPTION_LENGTH, holdDue } from "./content";
import { planQueue, type PlannerPost } from "./queue";
import {
  editProblem,
  isEditable,
  postNowProblem,
  removedMessage,
  savedMessage,
  slotsMessage,
  timingPatch,
} from "./queue-edit";

const NOW = new Date("2026-11-05T22:14:00Z");
const TZ = "Europe/London";

describe("isEditable", () => {
  it("allows waiting posts only", () => {
    expect(isEditable("queued")).toBe(true);
    expect(isEditable("paused")).toBe(true);
    expect(isEditable("publishing")).toBe(false);
    expect(isEditable("published")).toBe(false);
    expect(isEditable("failed")).toBe(false);
  });
});

describe("editProblem", () => {
  it("accepts a queue edit and a future pin", () => {
    expect(editProblem({ caption: "Hi", timing: { kind: "queue" } }, NOW)).toBeNull();
    expect(
      editProblem(
        { caption: "Hi", timing: { kind: "pinned", at: new Date("2026-11-06T16:30:00Z") } },
        NOW,
      ),
    ).toBeNull();
  });

  it("refuses long captions and past or invalid pins", () => {
    const long = "x".repeat(MAX_CAPTION_LENGTH + 1);
    expect(editProblem({ caption: long, timing: { kind: "queue" } }, NOW)).toBe("caption_too_long");
    expect(editProblem({ caption: "", timing: { kind: "pinned", at: NOW } }, NOW)).toBe(
      "pinned_past",
    );
    expect(editProblem({ caption: "", timing: { kind: "pinned", at: new Date(NaN) } }, NOW)).toBe(
      "pinned_invalid",
    );
  });
});

describe("timingPatch", () => {
  const at = new Date("2026-11-06T16:30:00Z");

  it("pins at the chosen time and keeps the backlog place", () => {
    expect(
      timingPatch(
        { timing: "queue", queuePosition: 3, scheduledAt: NOW },
        { kind: "pinned", at },
        [],
      ),
    ).toEqual({ timing: "pinned", queuePosition: 3, scheduledAt: at });
  });

  it("returns an unpinned post to its old place", () => {
    expect(
      timingPatch({ timing: "pinned", queuePosition: 3, scheduledAt: at }, { kind: "queue" }, []),
    ).toEqual({ timing: "queue", queuePosition: 3, scheduledAt: null });
  });

  it("sends a post with no place to the back of the queue", () => {
    expect(
      timingPatch({ timing: "pinned", queuePosition: null, scheduledAt: at }, { kind: "queue" }, [
        { queuePosition: 0 },
        { queuePosition: 7 },
      ]),
    ).toEqual({ timing: "queue", queuePosition: 8, scheduledAt: null });
  });

  it("leaves a queue post that stays in the queue alone", () => {
    const current = { timing: "queue" as const, queuePosition: 2, scheduledAt: NOW };
    expect(timingPatch(current, { kind: "queue" }, [])).toBe(current);
  });
});

describe("postNowProblem", () => {
  it("allows a queued post on a ready account with quota left", () => {
    expect(
      postNowProblem({ status: "queued", accountStatus: "ready", postsUsed24h: 3 }),
    ).toBeNull();
  });

  it("refuses busy posts, paused accounts and full quotas", () => {
    expect(postNowProblem({ status: "publishing", accountStatus: "ready", postsUsed24h: 0 })).toBe(
      "not_editable",
    );
    expect(
      postNowProblem({ status: "paused", accountStatus: "needs_attention", postsUsed24h: 0 }),
    ).toBe("account_paused");
    expect(postNowProblem({ status: "paused", accountStatus: "ready", postsUsed24h: 0 })).toBe(
      "post_paused",
    );
    expect(postNowProblem({ status: "queued", accountStatus: "ready", postsUsed24h: 100 })).toBe(
      "quota_full",
    );
  });
});

describe("the queue after an edit (planQueue)", () => {
  const slots = ["09:00", "13:00", "19:00"];
  const queue = (n: number): PlannerPost[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `q${i}`,
      timing: "queue",
      queuePosition: i,
      status: "queued",
    }));

  it("moves the second post into the first one's slot when the first is removed", () => {
    const before = planQueue({ slots, timezone: TZ, now: NOW, posts: queue(3) });
    const after = planQueue({ slots, timezone: TZ, now: NOW, posts: queue(3).slice(1) });
    expect(after[0]).toEqual({ id: "q1", scheduledAt: before[0]?.scheduledAt });
  });

  it("keeps a pinned post at its time when the queue changes", () => {
    const pinAt = new Date("2026-11-06T13:00:00Z");
    const posts = queue(4).map((p) =>
      p.id === "q2" ? { ...p, timing: "pinned" as const, scheduledAt: pinAt } : p,
    );
    const planned = planQueue({ slots, timezone: TZ, now: NOW, posts: posts.slice(1) });
    expect(planned.map((p) => p.id)).toEqual(["q1", "q3"]);
    expect(planned.map((p) => p.scheduledAt?.toISOString())).toEqual([
      "2026-11-06T09:00:00.000Z",
      "2026-11-06T19:00:00.000Z",
    ]);
  });
});

describe("toasts", () => {
  it("echo the action", () => {
    expect(savedMessage("pinned", new Date("2026-11-06T16:30:00Z"), NOW, TZ)).toBe(
      "Changes saved. Pinned to Tomorrow, 16:30.",
    );
    expect(savedMessage("queue", new Date("2026-11-06T09:00:00Z"), NOW, TZ)).toBe(
      "Changes saved. Posts in its queue slot, Tomorrow, 09:00.",
    );
    expect(savedMessage("queue", null, NOW, TZ)).toMatch(/waits in the backlog/);
    expect(removedMessage("codingjourney", "queue")).toBe(
      "Removed from @codingjourney's queue. Later posts moved up.",
    );
    expect(removedMessage("codingjourney", "pinned")).toBe("Removed from @codingjourney's queue.");
    expect(slotsMessage("trip.app", ["12:00"], ["12:00", "21:00"])).toBe(
      "Added a 21:00 slot to @trip.app.",
    );
    expect(slotsMessage("trip.app", ["12:00", "21:00"], ["12:00"])).toBe(
      "Removed the 21:00 slot from @trip.app.",
    );
    expect(slotsMessage("trip.app", ["12:00"], ["13:00"])).toBe("Saved @trip.app's posting slots.");
  });
});

describe("holdDue", () => {
  it("fixes queue posts that are due or claimed; leaves the rest to the planner", () => {
    const at = (iso: string) => new Date(iso);
    const held = holdDue(
      [
        { id: "due", timing: "queue", status: "queued", scheduledAt: at("2026-11-05T22:00:00Z") },
        {
          id: "claimed",
          timing: "queue",
          status: "queued",
          scheduledAt: at("2026-11-06T09:00:00Z"),
          claimed: true,
        },
        { id: "later", timing: "queue", status: "queued", scheduledAt: at("2026-11-06T13:00:00Z") },
        {
          id: "paused",
          timing: "queue",
          status: "paused",
          scheduledAt: at("2026-11-05T22:00:00Z"),
        },
      ],
      NOW,
    );
    expect(held.map((p) => p.timing)).toEqual(["pinned", "pinned", "queue", "queue"]);
    expect(held.every((p) => !("claimed" in p))).toBe(true);
  });
});
