import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  applyPublishOutcome,
  nextPublishAction,
  quotaWait,
  QUOTA_WAIT_MINUTES,
  type PublishAccount,
  type PublishOutcome,
  type PublishPost,
  type PublishResult,
} from "@/lib/domain/publish";
import { createInstagramProvider } from "@/lib/providers/instagram";
import type { ProviderAccount } from "@/lib/providers";
import { http, HttpResponse } from "msw";
import {
  FIXTURE_APP,
  FIXTURE_IG_USER,
  FIXTURE_TOKENS,
} from "../../../tests/fixtures/instagram/handlers";
import {
  createPublishFixture,
  publishFixtures,
  type PublishFixture,
  type PublishFixtureOptions,
} from "../../../tests/fixtures/instagram/publish/server";
import { advancePost } from "./publish-post";

// BC-16: the publish flow for Instagram, tick by tick, against the MSW stand-in for Instagram:
// the publish machine (domain) + the provider calls (publish-post.ts) + the Instagram provider.
// Each "tick" does what the scheduler's publishDue step does for one claimed post, minus the
// database; a "crash" is a tick whose result is never saved.

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const NOW = new Date("2026-11-06T10:00:00Z");
const SLOTS = ["09:00", "18:00"];
const TIMEZONE = "Europe/London";
const CAPTION = "Day 41 of learning to code";
const VIDEO_URL = "https://storage.test/videos/v41.mp4?token=signed";

const igAccount: ProviderAccount = {
  accountId: "acc-1",
  platformUserId: FIXTURE_IG_USER.id,
  accessToken: FIXTURE_TOKENS.long,
};
const ready: PublishAccount = { handle: "codingjourney", status: "ready", statusReason: null };

interface Stored extends PublishPost {
  containerCreatedAt: Date | null;
  nextAttemptAt: string | null;
  lastError: string | null;
  mediaId: string | null;
  permalink: string | null;
}

function setup(opts: PublishFixtureOptions & { aiGenerated?: boolean } = {}) {
  let now = NOW;
  const ig: PublishFixture = createPublishFixture({ now: () => now, ...opts });
  server.use(...ig.handlers);
  const provider = createInstagramProvider({
    config: FIXTURE_APP,
    now: () => now,
    timeoutMs: 2000,
  });
  const post: Stored = {
    status: "queued",
    containerId: null,
    attempts: 0,
    containerCreatedAt: null,
    nextAttemptAt: null,
    lastError: null,
    mediaId: null,
    permalink: null,
  };

  /** One tick for the post. `save: false` simulates a crash before the result is written. */
  async function tick(
    save = true,
  ): Promise<{ outcome: PublishOutcome | null; result: PublishResult | null }> {
    now = new Date(now.getTime() + 60_000);
    const action = nextPublishAction(post, ready);
    const outcome = await advancePost({
      provider,
      account: igAccount,
      post: {
        id: "p1",
        handle: ready.handle,
        caption: CAPTION,
        isAiGenerated: opts.aiGenerated ?? false,
        containerCreatedAt: post.containerCreatedAt,
      },
      action,
      videoUrl: () => Promise.resolve(VIDEO_URL),
      quotaWait: () => quotaWait({ slots: SLOTS, timezone: TIMEZONE, now }),
    });
    if (!outcome) return { outcome, result: null };
    const result = applyPublishOutcome(post, outcome, now);
    if (save) {
      const p = result.patch;
      post.status = p.status;
      if (p.container_id !== undefined) post.containerId = p.container_id;
      if (p.container_created_at !== undefined) {
        post.containerCreatedAt = p.container_created_at ? new Date(p.container_created_at) : null;
      }
      if (p.attempts !== undefined) post.attempts = p.attempts;
      if (p.next_attempt_at !== undefined) post.nextAttemptAt = p.next_attempt_at;
      if (p.last_error !== undefined) post.lastError = p.last_error;
      if (p.media_ig_id !== undefined) post.mediaId = p.media_ig_id;
      if (p.permalink !== undefined) post.permalink = p.permalink;
    }
    return { outcome, result };
  }

  return { ig, post, tick, now: () => now };
}

describe("publishing a Reel to Instagram", () => {
  it("discloses an avatar video as AI on its container (is_ai_generated)", async () => {
    const { ig, tick } = setup({ aiGenerated: true });
    expect((await tick()).outcome).toMatchObject({ kind: "container_created" });
    const [container] = [...ig.containers.values()];
    expect(container?.isAiGenerated).toBe("true");
  });

  it("happy path: checks the quota, uploads, then publishes once with the permalink", async () => {
    const { ig, post, tick } = setup();

    expect((await tick()).outcome).toEqual({
      kind: "container_created",
      containerId: "17900000000000001",
    });
    expect(post.status).toBe("publishing");
    expect(ig.calls.quota).toBe(1);
    const [container] = [...ig.containers.values()];
    expect(container).toMatchObject({
      caption: CAPTION,
      videoUrl: VIDEO_URL,
      mediaType: "REELS",
      shareToFeed: "true",
      isAiGenerated: null,
    });

    const second = await tick();
    expect(second.outcome).toEqual({
      kind: "published",
      mediaId: "17950000000000001",
      permalink: "https://www.instagram.com/reel/DFixture0001/",
    });
    expect(second.result?.log.message).toBe(
      "Published: https://www.instagram.com/reel/DFixture0001/",
    );
    expect(post).toMatchObject({ status: "published", mediaId: "17950000000000001" });
    // The quota was checked again right before publishing.
    expect(ig.calls.quota).toBe(2);
    expect(ig.calls).toMatchObject({ create: 1, publish: 1 });
    expect(ig.media).toHaveLength(1);

    // Nothing more to do.
    expect(nextPublishAction(post, ready)).toEqual({ kind: "none" });
  });

  it("a container still processing over 3 ticks is checked, not uploaded again", async () => {
    const { ig, post, tick } = setup({ readyAfterChecks: 4 });
    await tick();
    for (let i = 0; i < 3; i++) {
      expect((await tick()).outcome).toEqual({ kind: "processing" });
      expect(post).toMatchObject({
        status: "publishing",
        containerId: "17900000000000001",
        attempts: 0,
      });
    }
    expect((await tick()).outcome).toMatchObject({ kind: "published" });
    expect(ig.calls).toMatchObject({ create: 1, publish: 1 });
    expect(ig.containers.size).toBe(1);
  });

  it("quota exhausted: nothing is uploaded; the post waits for the account's next slot", async () => {
    const { ig, post, tick } = setup({ quotaUsage: 100, quotaTotal: 100 });
    const { outcome, result } = await tick();
    expect(outcome).toMatchObject({ kind: "quota_full" });
    expect(ig.calls.create).toBe(0);
    expect(post).toMatchObject({ status: "queued", containerId: null, attempts: 0 });
    // 10:01 in London: the next slot is 18:00 today.
    expect(post.nextAttemptAt).toBe("2026-11-06T18:00:00.000Z");
    expect(result?.log.message).toBe(
      "Waiting until the next slot (Today, 18:00): @codingjourney has used its 24-hour publishing limit (100 of 100). Posting resumes when it frees up.",
    );
  });

  it("quota used up between upload and publish: keeps the container and waits", async () => {
    const { ig, post, tick } = setup();
    await tick();
    ig.quota.usage = ig.quota.total;
    expect((await tick()).outcome).toMatchObject({ kind: "quota_full" });
    expect(post).toMatchObject({
      status: "publishing",
      containerId: "17900000000000001",
      attempts: 0,
    });
    expect(ig.calls.publish).toBe(0);

    ig.quota.usage = 0;
    expect((await tick()).outcome).toMatchObject({ kind: "published" });
    expect(ig.calls).toMatchObject({ create: 1, publish: 1 });
  });

  it("ERROR status (aspect ratio): fails with a clear reason and drops the container", async () => {
    const { ig, post, tick } = setup({ containerEnds: "error" });
    await tick();
    const { result } = await tick();
    expect(post).toMatchObject({ status: "failed", containerId: null, attempts: 1 });
    expect(post.lastError).toBe(
      "Instagram rejected the video's shape. Reels must be 9:16 (1080 × 1920); re-export it and add it again.",
    );
    expect(result?.log.message).toMatch(/^Failed: Instagram rejected the video's shape/);
    expect(ig.calls.publish).toBe(0);
  });

  it("ERROR status Broadcast doesn't recognise: fails with Instagram's message", async () => {
    const { post, tick } = setup({ containerEnds: "error_unknown" });
    await tick();
    await tick();
    expect(post.status).toBe("failed");
    expect(post.lastError).toBe(
      "Instagram couldn't process the video: Media upload has failed with error code 2207001",
    );
  });

  it("EXPIRED: uploads again on the retry, still publishing once", async () => {
    const { ig, post, tick } = setup({ containerEnds: "expired" });
    await tick();
    await tick();
    expect(post).toMatchObject({ status: "queued", containerId: null, attempts: 1 });
    ig.options.containerEnds = null;
    await tick();
    expect(ig.containers.size).toBe(2);
    expect((await tick()).outcome).toMatchObject({ kind: "published" });
    expect(ig.calls.publish).toBe(1);
  });

  it("publish timeout, then a recovered publish on the next tick without a duplicate", async () => {
    const { ig, post, tick } = setup();
    await tick();
    // media_publish goes through, but its answer and the re-check right after it are lost.
    ig.loseNextPublishAnswer(2);
    const timedOut = await tick();
    expect(timedOut.outcome).toMatchObject({ kind: "error", code: "network", retryable: true });
    expect(post).toMatchObject({
      status: "publishing",
      containerId: "17900000000000001",
      attempts: 1,
    });
    expect(ig.media).toHaveLength(1);

    const recovered = await tick();
    expect(recovered.outcome).toEqual({
      kind: "published",
      mediaId: "17950000000000001",
      permalink: "https://www.instagram.com/reel/DFixture0001/",
    });
    expect(ig.calls.publish).toBe(1);
    expect(ig.media).toHaveLength(1);
  });

  it("publish timeout recognised in the same tick when the re-check gets through", async () => {
    const { ig, tick } = setup();
    await tick();
    ig.loseNextPublishAnswer(1);
    expect((await tick()).outcome).toMatchObject({
      kind: "published",
      mediaId: "17950000000000001",
    });
    expect(ig.calls.publish).toBe(1);
  });

  it("a publish that never reached Instagram is retried and published once", async () => {
    const { ig, post, tick } = setup();
    await tick();
    ig.failNextPublish();
    expect((await tick()).outcome).toMatchObject({ kind: "error", code: "network" });
    expect(ig.media).toHaveLength(0);
    expect((await tick()).outcome).toMatchObject({ kind: "published" });
    expect(post.status).toBe("published");
    expect(ig.calls.publish).toBe(1);
    expect(ig.media).toHaveLength(1);
  });

  describe("crash points (the tick dies before saving its result)", () => {
    it("after media_publish: the next tick finds the post instead of publishing again", async () => {
      const { ig, post, tick } = setup();
      await tick();
      const crashed = await tick(false);
      expect(crashed.outcome).toMatchObject({ kind: "published" });
      expect(post.status).toBe("publishing");

      const next = await tick();
      expect(next.outcome).toEqual(crashed.outcome);
      expect(post).toMatchObject({ status: "published", mediaId: "17950000000000001" });
      expect(ig.calls.publish).toBe(1);
      expect(ig.media).toHaveLength(1);
    });

    it("after container creation: the unsaved container is never published", async () => {
      const { ig, post, tick } = setup();
      await tick(false);
      expect(post.containerId).toBeNull();
      // The retry uploads again (Instagram can't list containers); only the saved one is used.
      await tick();
      expect(post.containerId).toBe("17900000000000002");
      await tick();
      expect(post.status).toBe("published");
      expect(ig.containers.get("17900000000000001")?.mediaId).toBeNull();
      expect(ig.calls.publish).toBe(1);
      expect(ig.media).toHaveLength(1);
    });

    it("after a lost answer, when the post can't be matched: published without a link, never again", async () => {
      const { ig, post, tick } = setup();
      await tick();
      await tick(false);
      // Someone edited the caption on Instagram: no recent post matches any more.
      const [published] = ig.media;
      if (published) published.caption = "Edited on Instagram";
      const { result } = await tick();
      expect(post).toMatchObject({ status: "published", mediaId: null, permalink: null });
      expect(result?.log.ok).toBe(true);
      expect(ig.calls.publish).toBe(1);
    });

    it("the same tick replayed many times still publishes once", async () => {
      const { ig, tick } = setup();
      await tick();
      for (let i = 0; i < 5; i++) await tick(false);
      await tick();
      expect(ig.calls.publish).toBe(1);
      expect(ig.media).toHaveLength(1);
    });
  });

  it("an expired token pauses the post and flags the account", async () => {
    const { post, tick } = setup();
    server.use(
      http.get(
        `https://graph.facebook.com/:version/${FIXTURE_IG_USER.id}/content_publishing_limit`,
        () =>
          HttpResponse.json(
            {
              error: {
                message: "Error validating access token",
                type: "OAuthException",
                code: 190,
              },
            },
            { status: 400 },
          ),
      ),
    );
    const { result } = await tick();
    expect(post.status).toBe("paused");
    expect(result?.accountProblem).toBe(
      "Instagram access expired. Reconnect the account to resume posting.",
    );
  });

  it("rate limited: waits a few minutes without using a retry", async () => {
    const { post, tick, now } = setup();
    server.use(
      http.post(`https://graph.facebook.com/:version/${FIXTURE_IG_USER.id}/media`, () =>
        HttpResponse.json(
          {
            error: {
              message: "Application request limit reached",
              type: "OAuthException",
              code: 4,
            },
          },
          { status: 400 },
        ),
      ),
    );
    await tick();
    expect(post).toMatchObject({ status: "queued", attempts: 0 });
    expect(post.nextAttemptAt).toBe(
      new Date(now().getTime() + QUOTA_WAIT_MINUTES * 60_000).toISOString(),
    );
    expect(post.lastError).toMatch(/limiting requests/);
  });

  it("missing publishing permission pauses the post with how to fix it", async () => {
    const { post, tick } = setup();
    server.use(
      http.post(`https://graph.facebook.com/:version/${FIXTURE_IG_USER.id}/media`, () =>
        HttpResponse.json(publishFixtures.errorNoPermission, { status: 403 }),
      ),
    );
    const { result } = await tick();
    expect(post.status).toBe("paused");
    expect(result?.accountProblem).toMatch(/Reconnect it and allow publishing/);
  });
});
