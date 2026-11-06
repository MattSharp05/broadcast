import { createRng, hash32 } from "@/lib/hash";
import {
  ProviderError,
  type ContainerStatus,
  type MediaInsights,
  type ProviderAccount,
  type PublishedMedia,
  type SocialProvider,
  type TokenSet,
} from "./types";

/**
 * The fake SocialProvider (ADR 0003): deterministic, with its state in the database
 * (`fake_accounts`, `fake_containers`; see fake-store.ts). Used by Sandbox accounts, scenarios and
 * e2e. It never makes a network call.
 *
 * - A container reports FINISHED on its `readyAfterChecks`-th status check.
 * - Publishing returns a media id and permalink; publishing the same container again returns the
 *   same result.
 * - Insights grow along a seeded curve with the hours since publishing.
 * - Per-account failure modes, for `failuresLeft` calls (null: every call):
 *   `token_expired` and `network` fail every call; `quota_exhausted` fills the quota and fails
 *   publishing; `aspect_ratio` makes containers end in an error.
 */

export const FAKE_FAILURE_MODES = [
  "aspect_ratio",
  "quota_exhausted",
  "token_expired",
  "network",
] as const;
export type FakeFailureMode = (typeof FAKE_FAILURE_MODES)[number];

export interface FakeAccountState {
  accountId: string;
  handle: string;
  followers: number;
  failureMode: FakeFailureMode | null;
  failuresLeft: number | null;
  readyAfterChecks: number;
  quotaLimit: number;
}

export interface FakeContainer {
  id: string;
  accountId: string;
  videoUrl: string;
  caption: string;
  statusChecks: number;
  mediaId: string | null;
  permalink: string | null;
  publishedAt: Date | null;
}

/** Where the fake provider keeps its state. The database store is in fake-store.ts. */
export interface FakeStore {
  getAccount(accountId: string): Promise<FakeAccountState | null>;
  setFailuresLeft(accountId: string, failuresLeft: number): Promise<void>;
  getContainer(id: string): Promise<FakeContainer | null>;
  getContainerByMedia(mediaId: string): Promise<FakeContainer | null>;
  /** Insert or replace. */
  saveContainer(container: FakeContainer): Promise<void>;
  countPublishedSince(accountId: string, since: Date): Promise<number>;
}

export interface FakeProviderDeps {
  store: FakeStore;
  /** The Sandbox clock (src/lib/clock.ts → nowFor). */
  now: () => Date;
}

const HOUR_MS = 3_600_000;
const QUOTA_WINDOW_HOURS = 24;
const TOKEN_DAYS = 60;
export const FAKE_PERMALINK_BASE = "https://fake.broadcast.invalid";

function fakeId(prefix: string, ...parts: readonly string[]): string {
  const key = parts.join("|");
  return `${prefix}_${hash32(key).toString(36)}${hash32(key, 0x9e3779b9).toString(36)}`;
}

function errorFor(mode: FakeFailureMode): ProviderError {
  switch (mode) {
    case "token_expired":
      return new ProviderError({
        code: "token_expired",
        retryable: false,
        userMessage: "Instagram access expired. Reconnect the account to resume posting.",
      });
    case "network":
      return new ProviderError({
        code: "network",
        retryable: true,
        userMessage: "Couldn't reach Instagram. Broadcast will try again in a few minutes.",
      });
    case "quota_exhausted":
      return new ProviderError({
        code: "quota_exhausted",
        retryable: true,
        userMessage:
          "This account has used its 24-hour Instagram publishing limit. Posting resumes when it frees up.",
      });
    case "aspect_ratio":
      return new ProviderError({
        code: "invalid_media",
        retryable: false,
        userMessage:
          "Instagram rejected the video because it is 1080 × 1350. Reels must be 9:16 (1080 × 1920).",
      });
  }
}

/** Views etc. for a post `hours` after publishing; seeded by the media id. */
export function fakeInsights(mediaId: string, followers: number, hours: number): MediaInsights {
  const r = createRng(hash32(mediaId));
  const base = Math.max(followers, 50) * (0.6 + r() * 3.2);
  const curve = 1 - Math.exp(-Math.max(hours, 0) / 20);
  const views = Math.round(base * curve);
  return {
    views,
    reach: Math.round(views * (0.7 + r() * 0.2)),
    likes: Math.round(views * (0.04 + r() * 0.05)),
    comments: Math.round(views * (0.003 + r() * 0.006)),
    shares: Math.round(views * (0.002 + r() * 0.01)),
    saves: Math.round(views * (0.004 + r() * 0.01)),
  };
}

export function createFakeProvider({ store, now }: FakeProviderDeps): SocialProvider {
  async function account(ctx: ProviderAccount): Promise<FakeAccountState> {
    const state = await store.getAccount(ctx.accountId);
    if (!state) {
      throw new ProviderError({
        code: "not_found",
        retryable: false,
        userMessage: "This Sandbox account has no fake provider settings. Reload its scenario.",
      });
    }
    return state;
  }

  /**
   * True when the account's failure mode applies to this call. Uses up one failure unless
   * `consume` is false (read-only checks, like the quota check before publishing).
   */
  async function fails(state: FakeAccountState, modes: readonly FakeFailureMode[], consume = true) {
    if (!state.failureMode || !modes.includes(state.failureMode)) return false;
    if (state.failuresLeft === null) return true;
    if (state.failuresLeft <= 0) return false;
    if (!consume) return true;
    state.failuresLeft -= 1;
    await store.setFailuresLeft(state.accountId, state.failuresLeft);
    return true;
  }

  /** token_expired and network break every call. */
  async function guard(ctx: ProviderAccount): Promise<FakeAccountState> {
    const state = await account(ctx);
    if (state.failureMode && (await fails(state, ["token_expired", "network"]))) {
      throw errorFor(state.failureMode);
    }
    return state;
  }

  async function container(id: string, accountId: string): Promise<FakeContainer> {
    const found = await store.getContainer(id);
    if (found?.accountId !== accountId) {
      throw new ProviderError({
        code: "not_found",
        retryable: false,
        userMessage: "Instagram has no record of this upload. It will be uploaded again.",
      });
    }
    return found;
  }

  function tokens(platformUserId: string, seed: string): TokenSet {
    return {
      accessToken: fakeId("fake_token", seed, now().toISOString()),
      expiresAt: new Date(now().getTime() + TOKEN_DAYS * 24 * HOUR_MS),
      platformUserId,
      scopes: ["fake_basic", "fake_content_publish", "fake_insights"],
    };
  }

  return {
    platform: "fake",

    authorizeUrl({ state, redirectUri }) {
      // No consent screen: straight back to the callback with a code.
      const url = new URL(redirectUri);
      url.searchParams.set("code", fakeId("fake_code", state));
      url.searchParams.set("state", state);
      return url.toString();
    },

    exchangeCode({ code }) {
      return Promise.resolve(tokens(fakeId("fake_user", code), code));
    },

    async refreshToken(ctx) {
      await guard(ctx);
      return tokens(ctx.platformUserId ?? fakeId("fake_user", ctx.accountId), ctx.accessToken);
    },

    async getProfile(ctx) {
      const state = await guard(ctx);
      return {
        platformUserId: ctx.platformUserId ?? fakeId("fake_user", ctx.accountId),
        handle: state.handle,
        profileUrl: `${FAKE_PERMALINK_BASE}/${state.handle}`,
        followers: state.followers,
      };
    },

    async getPublishingQuota(ctx) {
      const state = await guard(ctx);
      if (await fails(state, ["quota_exhausted"], false)) {
        return { used: state.quotaLimit, limit: state.quotaLimit, windowHours: QUOTA_WINDOW_HOURS };
      }
      const since = new Date(now().getTime() - QUOTA_WINDOW_HOURS * HOUR_MS);
      const used = await store.countPublishedSince(ctx.accountId, since);
      return { used, limit: state.quotaLimit, windowHours: QUOTA_WINDOW_HOURS };
    },

    async createReelContainer(ctx, { videoUrl, caption }) {
      await guard(ctx);
      // Every call makes a new container, like Instagram. Ids are deterministic: the first free one
      // for (account, video, caption, now).
      const key = [ctx.accountId, videoUrl, caption, now().toISOString()];
      let id = fakeId("fake_container", ...key);
      for (let n = 2; await store.getContainer(id); n++) {
        id = fakeId("fake_container", ...key, `${n}`);
      }
      await store.saveContainer({
        id,
        accountId: ctx.accountId,
        videoUrl,
        caption,
        statusChecks: 0,
        mediaId: null,
        permalink: null,
        publishedAt: null,
      });
      return { containerId: id };
    },

    async getContainerStatus(ctx, containerId): Promise<ContainerStatus> {
      const state = await guard(ctx);
      const c = await container(containerId, ctx.accountId);
      if (c.mediaId) return { state: "finished" };
      if (await fails(state, ["aspect_ratio"])) {
        return { state: "error", error: errorFor("aspect_ratio") };
      }
      c.statusChecks += 1;
      await store.saveContainer(c);
      return c.statusChecks >= state.readyAfterChecks
        ? { state: "finished" }
        : { state: "in_progress" };
    },

    async publishContainer(ctx, containerId): Promise<PublishedMedia> {
      const state = await guard(ctx);
      const c = await container(containerId, ctx.accountId);
      if (c.mediaId && c.permalink) return { mediaId: c.mediaId, permalink: c.permalink };
      if (c.statusChecks < state.readyAfterChecks) {
        throw new ProviderError({
          code: "not_ready",
          retryable: true,
          userMessage: "Instagram is still processing the video. Broadcast will try again shortly.",
        });
      }
      if (await fails(state, ["quota_exhausted"])) throw errorFor("quota_exhausted");
      const since = new Date(now().getTime() - QUOTA_WINDOW_HOURS * HOUR_MS);
      if ((await store.countPublishedSince(ctx.accountId, since)) >= state.quotaLimit) {
        throw errorFor("quota_exhausted");
      }
      const mediaId = fakeId("fake_media", containerId);
      const published: FakeContainer = {
        ...c,
        mediaId,
        permalink: `${FAKE_PERMALINK_BASE}/${state.handle}/reel/${mediaId}`,
        publishedAt: now(),
      };
      await store.saveContainer(published);
      return { mediaId, permalink: published.permalink ?? "" };
    },

    async getMediaInsights(ctx, mediaId) {
      const state = await guard(ctx);
      const c = await store.getContainerByMedia(mediaId);
      if (c?.accountId !== ctx.accountId || !c.publishedAt) {
        throw new ProviderError({
          code: "not_found",
          retryable: false,
          userMessage: "Instagram has no stats for this post.",
        });
      }
      const hours = (now().getTime() - c.publishedAt.getTime()) / HOUR_MS;
      return fakeInsights(mediaId, state.followers, hours);
    },

    async getFollowerCount(ctx) {
      const state = await guard(ctx);
      return state.followers;
    },
  };
}

/** An in-memory FakeStore, for unit tests and tools. */
export function createMemoryFakeStore(accounts: readonly FakeAccountState[] = []): FakeStore & {
  containers: Map<string, FakeContainer>;
  accounts: Map<string, FakeAccountState>;
} {
  const accountMap = new Map(accounts.map((a) => [a.accountId, { ...a }]));
  const containers = new Map<string, FakeContainer>();
  return {
    accounts: accountMap,
    containers,
    getAccount: (id) => {
      const a = accountMap.get(id);
      return Promise.resolve(a ? { ...a } : null);
    },
    setFailuresLeft: (id, failuresLeft) => {
      const a = accountMap.get(id);
      if (a) a.failuresLeft = failuresLeft;
      return Promise.resolve();
    },
    getContainer: (id) => {
      const c = containers.get(id);
      return Promise.resolve(c ? { ...c } : null);
    },
    getContainerByMedia: (mediaId) => {
      const c = [...containers.values()].find((x) => x.mediaId === mediaId);
      return Promise.resolve(c ? { ...c } : null);
    },
    saveContainer: (c) => {
      containers.set(c.id, { ...c });
      return Promise.resolve();
    },
    countPublishedSince: (accountId, since) =>
      Promise.resolve(
        [...containers.values()].filter(
          (c) => c.accountId === accountId && c.publishedAt && c.publishedAt >= since,
        ).length,
      ),
  };
}
