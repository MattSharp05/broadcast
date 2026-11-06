import { describe, expect, it } from "vitest";
import { DAILY_POST_LIMIT } from "./details";
import {
  ATTEMPTS_SHOWN,
  REPLACE_LOG,
  RETRY_LOG,
  attemptResult,
  attemptRows,
  removeProblem,
  removedFailedMessage,
  replaceProblem,
  retryPatch,
  retryProblem,
  type FailedPostState,
} from "./failed-posts";

const NOW = new Date("2026-11-05T22:14:00Z");
const TZ = "Europe/London";

const failed: FailedPostState = {
  status: "failed",
  containerId: null,
  accountStatus: "ready",
  postsUsed24h: 3,
};

describe("retryProblem", () => {
  it("allows a failed post on a ready account with quota left", () => {
    expect(retryProblem(failed)).toBeNull();
    expect(retryProblem({ ...failed, containerId: "c1" })).toBeNull();
  });

  it("refuses posts that aren't failed any more", () => {
    for (const status of ["queued", "publishing", "published", "removed", "paused"] as const) {
      expect(retryProblem({ ...failed, status })).toBe("not_failed");
    }
  });

  it("refuses accounts that need attention and full quotas", () => {
    expect(retryProblem({ ...failed, accountStatus: "needs_attention" })).toBe("account_paused");
    expect(retryProblem({ ...failed, postsUsed24h: DAILY_POST_LIMIT })).toBe("quota_full");
  });

  it("always allows checking a kept container (it posts nothing new)", () => {
    const kept = { ...failed, containerId: "c1" };
    expect(retryProblem({ ...kept, accountStatus: "needs_attention" })).toBeNull();
    expect(retryProblem({ ...kept, postsUsed24h: DAILY_POST_LIMIT })).toBeNull();
  });
});

describe("replaceProblem", () => {
  it("allows a failed post without a kept container", () => {
    expect(replaceProblem(failed)).toBeNull();
  });

  it("refuses while a container is kept (it may be live already)", () => {
    expect(replaceProblem({ ...failed, containerId: "c1" })).toBe("container_kept");
  });

  it("refuses non-failed posts, paused accounts and full quotas", () => {
    expect(replaceProblem({ ...failed, status: "queued" })).toBe("not_failed");
    expect(replaceProblem({ ...failed, accountStatus: "not_connected" })).toBe("account_paused");
    expect(replaceProblem({ ...failed, postsUsed24h: DAILY_POST_LIMIT })).toBe("quota_full");
  });
});

describe("removeProblem", () => {
  it("allows a failed post without a container; refuses a kept one (it may be live)", () => {
    expect(removeProblem(failed)).toBeNull();
    expect(removeProblem({ ...failed, containerId: "c1" })).toBe("container_kept");
    expect(removeProblem({ ...failed, status: "removed" })).toBe("not_failed");
  });
});

describe("retryPatch", () => {
  it("pins a post without a container to now, retries reset", () => {
    expect(retryPatch(null, NOW)).toEqual({
      status: "queued",
      attempts: 0,
      last_error: null,
      next_attempt_at: null,
      timing: "pinned",
      scheduled_at: NOW.toISOString(),
    });
  });

  it("hands a kept container back to the scheduler, to be checked first", () => {
    const patch = retryPatch("c1", NOW);
    expect(patch).toEqual({
      status: "publishing",
      attempts: 0,
      last_error: null,
      next_attempt_at: NOW.toISOString(),
    });
    // The queue position and timing stay: nothing renumbers the queue.
    expect(patch).not.toHaveProperty("queue_position");
  });
});

describe("attempts list", () => {
  it("shortens each publish log line", () => {
    const r = (message: string, ok = false) => attemptResult({ at: NOW, ok, message });
    expect(r("Uploaded the video (container x).", true)).toBe("Uploaded");
    expect(r("Retrying in 2 min: Couldn't reach Instagram.")).toBe("Error, retry in 2 min");
    expect(r("Failed after 3 retries: x")).toBe("Failed, stopped");
    expect(r("Failed: Instagram rejected the video")).toBe("Failed, stopped");
    expect(r("Published: https://x", true)).toBe("Published");
    expect(r("The platform is still processing the video.", true)).toBe("Processing");
    expect(r("Waiting until the next slot: full")).toBe("Waiting for quota");
    expect(r("Paused: reconnect")).toBe("Paused");
    expect(r(RETRY_LOG, true)).toBe("Retry requested");
    expect(r(REPLACE_LOG, true)).toBe("Video replaced");
    expect(r("Something else")).toBe("Error");
  });

  it("lists the latest lines oldest first, with the time (and day when not today)", () => {
    const lines = [
      { at: new Date("2026-11-05T22:02:00Z"), ok: false, message: "Failed: x" },
      { at: new Date("2026-11-04T18:30:00Z"), ok: true, message: "Uploaded the video (c)." },
    ];
    expect(attemptRows(lines, NOW, TZ)).toEqual([
      {
        time: "Yesterday, 18:30",
        result: "Uploaded",
        message: "Uploaded the video (c).",
        ok: true,
      },
      { time: "22:02", result: "Failed, stopped", message: "Failed: x", ok: false },
    ]);
  });

  it(`shows at most ${ATTEMPTS_SHOWN} lines`, () => {
    const lines = Array.from({ length: 12 }, (_, i) => ({
      at: new Date(NOW.getTime() - (12 - i) * 60_000),
      ok: false,
      message: `Retrying in 1 min: ${i}`,
    }));
    const rows = attemptRows(lines, NOW, TZ);
    expect(rows).toHaveLength(ATTEMPTS_SHOWN);
    expect(rows.at(-1)?.message).toBe("Retrying in 1 min: 11");
  });
});

it("words the remove toast", () => {
  expect(removedFailedMessage("wrong.shape")).toBe("Removed the failed post from @wrong.shape.");
});
