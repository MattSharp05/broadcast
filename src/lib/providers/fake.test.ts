import { describe, expect, it } from "vitest";
import {
  createFakeProvider,
  createMemoryFakeStore,
  fakeInsights,
  type FakeAccountState,
  type FakeFailureMode,
} from "./fake";
import { ProviderError, type ProviderAccount } from "./types";

const ACCOUNT_ID = "acc-1";
const ctx: ProviderAccount = { accountId: ACCOUNT_ID, platformUserId: "u1", accessToken: "t" };

function setup(overrides: Partial<FakeAccountState> = {}) {
  const store = createMemoryFakeStore([
    {
      accountId: ACCOUNT_ID,
      handle: "codingjourney",
      followers: 1240,
      failureMode: null,
      failuresLeft: null,
      readyAfterChecks: 2,
      quotaLimit: 100,
      ...overrides,
    },
  ]);
  let now = new Date("2026-11-05T22:14:00Z");
  const provider = createFakeProvider({ store, now: () => now });
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  return { store, provider, advance };
}

async function publishOne(p: ReturnType<typeof setup>["provider"], video = "https://v/1.mp4") {
  const { containerId } = await p.createReelContainer(ctx, { videoUrl: video, caption: "Hi" });
  await p.getContainerStatus(ctx, containerId);
  await p.getContainerStatus(ctx, containerId);
  return { containerId, media: await p.publishContainer(ctx, containerId) };
}

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ProviderError) return e;
    throw e;
  }
  throw new Error("expected the call to fail");
}

describe("fake provider: container progression", () => {
  it("finishes on the configured status check, then publishes once", async () => {
    const { provider } = setup({ readyAfterChecks: 3 });
    const { containerId } = await provider.createReelContainer(ctx, {
      videoUrl: "https://v/1.mp4",
      caption: "Day 41",
    });
    expect(await provider.getContainerStatus(ctx, containerId)).toEqual({ state: "in_progress" });
    expect(await provider.getContainerStatus(ctx, containerId)).toEqual({ state: "in_progress" });
    expect(await provider.getContainerStatus(ctx, containerId)).toEqual({ state: "finished" });

    const first = await provider.publishContainer(ctx, containerId);
    expect(first.mediaId).toMatch(/^fake_media_/);
    expect(first.permalink).toContain("/codingjourney/reel/");
    // Publishing again returns the same media: never posted twice.
    expect(await provider.publishContainer(ctx, containerId)).toEqual(first);
  });

  it("refuses to publish a container that is still processing", async () => {
    const { provider } = setup();
    const { containerId } = await provider.createReelContainer(ctx, {
      videoUrl: "https://v/1.mp4",
      caption: "",
    });
    const err = await rejection(provider.publishContainer(ctx, containerId));
    expect(err.code).toBe("not_ready");
    expect(err.retryable).toBe(true);
  });

  it("is deterministic: same inputs, same ids", async () => {
    const a = await publishOne(setup().provider);
    const b = await publishOne(setup().provider);
    expect(a).toEqual(b);
  });

  it("makes a new container per call, even for the same video under a frozen clock", async () => {
    const { provider } = setup();
    const input = { videoUrl: "https://v/1.mp4", caption: "Same" };
    const a = await provider.createReelContainer(ctx, input);
    const b = await provider.createReelContainer(ctx, input);
    expect(a.containerId).not.toBe(b.containerId);
  });

  it("doesn't know another account's container", async () => {
    const { provider } = setup();
    const { containerId } = await provider.createReelContainer(ctx, {
      videoUrl: "https://v/1.mp4",
      caption: "",
    });
    const err = await rejection(
      provider.getContainerStatus({ ...ctx, accountId: "other" }, containerId),
    );
    expect(err.code).toBe("not_found");
  });
});

describe("fake provider: quota and insights", () => {
  it("counts published posts in the last 24 hours and stops at the limit", async () => {
    const { provider, advance } = setup({ quotaLimit: 2 });
    await publishOne(provider, "https://v/1.mp4");
    advance(60_000);
    await publishOne(provider, "https://v/2.mp4");
    expect(await provider.getPublishingQuota(ctx)).toEqual({ used: 2, limit: 2, windowHours: 24 });

    advance(60_000);
    const err = await rejection(publishOne(provider, "https://v/3.mp4"));
    expect(err.code).toBe("quota_exhausted");

    advance(25 * 3_600_000);
    expect((await provider.getPublishingQuota(ctx)).used).toBe(0);
  });

  it("insights grow with time and are seeded by the media id", async () => {
    const { provider, advance } = setup();
    const { media } = await publishOne(provider);
    advance(3_600_000);
    const hour1 = await provider.getMediaInsights(ctx, media.mediaId);
    advance(47 * 3_600_000);
    const hour48 = await provider.getMediaInsights(ctx, media.mediaId);
    expect(hour48.views).toBeGreaterThan(hour1.views);
    expect(hour48.likes).toBeGreaterThanOrEqual(hour1.likes);
    expect(fakeInsights("m1", 1000, 10)).toEqual(fakeInsights("m1", 1000, 10));
    expect(fakeInsights("m1", 1000, 0).views).toBe(0);
  });

  it("returns the profile and follower count", async () => {
    const { provider } = setup();
    expect(await provider.getFollowerCount(ctx)).toBe(1240);
    expect((await provider.getProfile(ctx)).handle).toBe("codingjourney");
  });
});

describe("fake provider: failure modes", () => {
  it.each<[FakeFailureMode, string, boolean]>([
    ["token_expired", "token_expired", false],
    ["network", "network", true],
  ])("%s fails every call (code %s, retryable %s)", async (mode, code, retryable) => {
    const { provider } = setup({ failureMode: mode });
    for (const call of [
      provider.getProfile(ctx),
      provider.getFollowerCount(ctx),
      provider.refreshToken(ctx),
      provider.createReelContainer(ctx, { videoUrl: "https://v/1.mp4", caption: "" }),
    ]) {
      const err = await rejection(call);
      expect(err.code).toBe(code);
      expect(err.retryable).toBe(retryable);
      expect(err.userMessage.length).toBeGreaterThan(10);
    }
  });

  it("quota_exhausted fills the quota and blocks publishing", async () => {
    const { provider } = setup({ failureMode: "quota_exhausted" });
    expect(await provider.getPublishingQuota(ctx)).toEqual({
      used: 100,
      limit: 100,
      windowHours: 24,
    });
    const err = await rejection(publishOne(provider));
    expect(err.code).toBe("quota_exhausted");
    expect(err.retryable).toBe(true);
  });

  it("the quota check doesn't use up a limited quota_exhausted failure", async () => {
    const { provider } = setup({ failureMode: "quota_exhausted", failuresLeft: 1 });
    expect((await provider.getPublishingQuota(ctx)).used).toBe(100);
    expect((await provider.getPublishingQuota(ctx)).used).toBe(100);
    const err = await rejection(publishOne(provider));
    expect(err.code).toBe("quota_exhausted");
    expect((await provider.getPublishingQuota(ctx)).used).toBe(0);
  });

  it("aspect_ratio ends the container in a non-retryable error", async () => {
    const { provider } = setup({ failureMode: "aspect_ratio" });
    const { containerId } = await provider.createReelContainer(ctx, {
      videoUrl: "https://v/1.mp4",
      caption: "",
    });
    const status = await provider.getContainerStatus(ctx, containerId);
    expect(status.state).toBe("error");
    if (status.state !== "error") return;
    expect(status.error.code).toBe("invalid_media");
    expect(status.error.retryable).toBe(false);
    expect(status.error.userMessage).toContain("9:16");
  });

  it("fails only `failuresLeft` times, then recovers", async () => {
    const { provider, store } = setup({ failureMode: "network", failuresLeft: 2 });
    await rejection(provider.getFollowerCount(ctx));
    await rejection(provider.getFollowerCount(ctx));
    expect(await provider.getFollowerCount(ctx)).toBe(1240);
    expect(store.accounts.get(ACCOUNT_ID)?.failuresLeft).toBe(0);
  });

  it("an account without fake settings is a clear error", async () => {
    const { provider } = setup();
    const err = await rejection(provider.getProfile({ ...ctx, accountId: "missing" }));
    expect(err.code).toBe("not_found");
  });
});

describe("fake provider: OAuth", () => {
  it("authorizeUrl goes straight back to the callback with a code and the state", () => {
    const { provider } = setup();
    const url = new URL(
      provider.authorizeUrl({ state: "s1", redirectUri: "http://localhost:3000/cb" }),
    );
    expect(url.pathname).toBe("/cb");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("code")).toMatch(/^fake_code_/);
  });

  it("exchangeCode returns a 60-day token", async () => {
    const { provider } = setup();
    const t = await provider.exchangeCode({ code: "c", redirectUri: "http://x/cb" });
    expect(t.expiresAt.getTime() - new Date("2026-11-05T22:14:00Z").getTime()).toBe(
      60 * 24 * 3_600_000,
    );
    expect(t.platformUserId).toMatch(/^fake_user_/);
  });
});
