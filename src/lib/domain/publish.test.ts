import { describe, expect, it } from "vitest";
import {
  PUBLISH_MAX_RETRIES,
  QUOTA_WAIT_MINUTES,
  applyPublishOutcome,
  backoffMinutes,
  nextPublishAction,
  quotaWait,
  type PublishAccount,
  type PublishOutcome,
  type PublishPost,
} from "./publish";

const NOW = new Date("2026-11-05T22:14:00Z");
const plus = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const ready: PublishAccount = { handle: "codingjourney", status: "ready", statusReason: null };
const queued: PublishPost = { status: "queued", containerId: null, attempts: 0 };
const publishing: PublishPost = { status: "publishing", containerId: "c1", attempts: 0 };

const networkError: PublishOutcome = {
  kind: "error",
  code: "network",
  retryable: true,
  message: "Couldn't reach Instagram.",
};

describe("nextPublishAction", () => {
  it("creates a container for a queued post", () => {
    expect(nextPublishAction(queued, ready)).toEqual({ kind: "create_container" });
  });

  it("checks the container of a publishing post", () => {
    expect(nextPublishAction(publishing, ready)).toEqual({
      kind: "check_container",
      containerId: "c1",
    });
  });

  it("retries a queued post whose earlier container was dropped", () => {
    expect(nextPublishAction({ ...queued, attempts: 2 }, ready)).toEqual({
      kind: "create_container",
    });
  });

  it("pauses when the account isn't ready, with its reason", () => {
    const account: PublishAccount = {
      ...ready,
      status: "needs_attention",
      statusReason: "Instagram access expired.",
    };
    expect(nextPublishAction(queued, account)).toEqual({
      kind: "pause",
      reason: "Instagram access expired.",
    });
    expect(nextPublishAction(queued, { ...account, statusReason: null })).toMatchObject({
      kind: "pause",
      reason: expect.stringContaining("@codingjourney needs attention") as string,
    });
  });

  it("still finishes a container that already exists on an account that needs attention", () => {
    expect(nextPublishAction(publishing, { ...ready, status: "needs_attention" })).toMatchObject({
      kind: "check_container",
    });
  });

  it.each(["published", "failed", "paused", "removed"] as const)(
    "does nothing for %s",
    (status) => {
      expect(nextPublishAction({ ...queued, status }, ready)).toEqual({ kind: "none" });
    },
  );
});

describe("applyPublishOutcome: the happy path", () => {
  it("container created → publishing, checked on the next tick", () => {
    const r = applyPublishOutcome(queued, { kind: "container_created", containerId: "c1" }, NOW);
    expect(r.patch).toEqual({
      status: "publishing",
      container_id: "c1",
      container_created_at: NOW.toISOString(),
      next_attempt_at: NOW.toISOString(),
      last_error: null,
    });
    expect(r.log.ok).toBe(true);
  });

  it("still processing → publishing, checked again next tick", () => {
    const r = applyPublishOutcome(publishing, { kind: "processing" }, NOW);
    expect(r.patch).toEqual({ status: "publishing", next_attempt_at: NOW.toISOString() });
  });

  it("published → published with media id, permalink and time", () => {
    const r = applyPublishOutcome(
      publishing,
      { kind: "published", mediaId: "m1", permalink: "https://example.invalid/p/m1" },
      NOW,
    );
    expect(r.patch).toEqual({
      status: "published",
      published_at: NOW.toISOString(),
      media_ig_id: "m1",
      permalink: "https://example.invalid/p/m1",
      next_attempt_at: null,
      last_error: null,
    });
    expect(r.log).toEqual({ ok: true, message: "Published: https://example.invalid/p/m1" });
  });
});

describe("applyPublishOutcome: backoff", () => {
  it("is 1, 2 then 4 minutes, and none after the third retry", () => {
    expect([1, 2, 3, 4].map(backoffMinutes)).toEqual([1, 2, 4, null]);
    expect(PUBLISH_MAX_RETRIES).toBe(3);
  });

  it("walks a post through 3 retries and then fails it", () => {
    let post: PublishPost = queued;
    const waits: (string | null | undefined)[] = [];
    for (let i = 0; i < 3; i++) {
      const r = applyPublishOutcome(post, networkError, NOW);
      expect(r.patch.status).toBe("queued");
      expect(r.log.ok).toBe(false);
      waits.push(r.patch.next_attempt_at);
      post = { ...post, attempts: r.patch.attempts ?? post.attempts };
    }
    expect(waits).toEqual([plus(1), plus(2), plus(4)]);
    expect(post.attempts).toBe(3);

    const last = applyPublishOutcome(post, networkError, NOW);
    expect(last.patch).toEqual({
      status: "failed",
      container_id: null,
      attempts: 4,
      next_attempt_at: null,
      last_error: "Couldn't reach Instagram.",
    });
    expect(last.log.message).toBe("Failed after 3 retries: Couldn't reach Instagram.");
  });

  it("keeps the container (and publishing) on a retryable error while publishing", () => {
    const r = applyPublishOutcome(publishing, networkError, NOW);
    expect(r.patch).toMatchObject({
      status: "publishing",
      container_id: "c1",
      attempts: 1,
      next_attempt_at: plus(1),
    });
  });

  it("drops a broken container so the retry uploads again", () => {
    const r = applyPublishOutcome(
      publishing,
      { ...networkError, code: "not_found", dropContainer: true },
      NOW,
    );
    expect(r.patch).toMatchObject({ status: "queued", container_id: null, attempts: 1 });
  });

  it("fails at once on an error retrying can't fix", () => {
    const r = applyPublishOutcome(
      publishing,
      {
        kind: "error",
        code: "invalid_media",
        retryable: false,
        message: "Reels must be 9:16.",
        dropContainer: true,
      },
      NOW,
    );
    expect(r.patch).toEqual({
      status: "failed",
      container_id: null,
      container_created_at: null,
      attempts: 1,
      next_attempt_at: null,
      last_error: "Reels must be 9:16.",
    });
    expect(r.log.message).toBe("Failed: Reels must be 9:16.");
  });
});

describe("applyPublishOutcome: waiting and pausing", () => {
  it("waits for the quota without using a retry", () => {
    const r = applyPublishOutcome(queued, { kind: "quota_full", message: "Limit reached." }, NOW);
    expect(r.patch).toEqual({
      status: "queued",
      next_attempt_at: plus(QUOTA_WAIT_MINUTES),
      last_error: "Limit reached.",
    });
    expect(r.patch.attempts).toBeUndefined();
  });

  it("waits until the given time (the account's next slot), keeping the container", () => {
    const at = new Date("2026-11-06T09:00:00Z");
    const r = applyPublishOutcome(
      publishing,
      { kind: "quota_full", message: "Limit reached.", wait: { at, label: "the next slot" } },
      NOW,
    );
    expect(r.patch).toEqual({
      status: "publishing",
      next_attempt_at: at.toISOString(),
      last_error: "Limit reached.",
    });
    expect(r.patch.container_id).toBeUndefined();
    expect(r.log).toEqual({ ok: false, message: "Waiting until the next slot: Limit reached." });
  });

  it("a recovered publish without a known link is still published", () => {
    const r = applyPublishOutcome(
      publishing,
      { kind: "published", mediaId: null, permalink: null },
      NOW,
    );
    expect(r.patch).toMatchObject({ status: "published", media_ig_id: null, permalink: null });
    expect(r.log.ok).toBe(true);
    expect(r.log.message).toMatch(/already had it/);
  });

  it("pauses the post", () => {
    const r = applyPublishOutcome(queued, { kind: "paused", reason: "Reconnect it." }, NOW);
    expect(r.patch).toEqual({
      status: "paused",
      next_attempt_at: null,
      last_error: "Reconnect it.",
    });
    expect(r.accountProblem).toBeUndefined();
  });

  it("an expired token pauses the post and flags the account", () => {
    const r = applyPublishOutcome(
      queued,
      { kind: "error", code: "token_expired", retryable: false, message: "Access expired." },
      NOW,
    );
    expect(r.patch.status).toBe("paused");
    expect(r.accountProblem).toBe("Access expired.");
  });
});

describe("quotaWait", () => {
  it("waits for the account's next slot", () => {
    // 22:14 in London: the next slot is tomorrow 09:00.
    const w = quotaWait({ slots: ["09:00", "18:00"], timezone: "Europe/London", now: NOW });
    expect(w.at.toISOString()).toBe("2026-11-06T09:00:00.000Z");
    expect(w.label).toBe("the next slot (Tomorrow, 09:00)");
  });

  it("falls back to a fixed wait without slots", () => {
    const w = quotaWait({ slots: [], timezone: "Europe/London", now: NOW });
    expect(w.at.toISOString()).toBe(plus(QUOTA_WAIT_MINUTES));
    expect(w.label).toBe(`${QUOTA_WAIT_MINUTES} min`);
  });
});
