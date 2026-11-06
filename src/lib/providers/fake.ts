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
 *   publishing; `aspect_ratio` makes containers of videos that aren't 9:16 (or whose size the
 *   store doesn't know) end in an error.
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
  /**
   * The size of the video at `videoUrl` (for Sandbox posts, the media's storage path), or null
   * when unknown. Lets `aspect_ratio` reject only videos that aren't 9:16, so replacing the video
   * fixes it (BC-20). Without it every container fails in that mode.
   */
  videoSize?(videoUrl: string): Promise<{ width: number; height: number } | null>;
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

/** MediaInsights with every metric reported (the fake reports them all). */
export type FakeInsights = { [K in keyof MediaInsights]: number };

/** Views etc. for a post `hours` after publishing; seeded by the media id. */
export function fakeInsights(mediaId: string, followers: number, hours: number): FakeInsights {
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

// ───────────── fake consent (connecting a Sandbox account) ─────────────

/** The fake consent screen: the Sandbox's stand-in for Instagram's "Allow" page. */
export const FAKE_CONSENT_PATH = "/connect/fake";
/** Every scope the fake provider can grant. */
export const FAKE_SCOPES = ["fake_basic", "fake_content_publish", "fake_insights"] as const;
const FAKE_CODE_PREFIX = "fake_code.";
const FAKE_USER_PREFIX = "fake_user_";
const FAKE_NEW_FOLLOWERS_BASE = 500;
const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

export interface FakeConsent {
  /** The fake Instagram user who signs in (their handle). */
  handle: string;
  /** What they allowed. */
  scopes: string[];
}

/** Lower-cased, or null when it isn't a valid Instagram-style handle. */
export function normalizeFakeHandle(value: string): string | null {
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  return HANDLE_RE.test(handle) ? handle : null;
}

/** The code the fake consent screen hands the callback: who signed in and what they allowed. */
export function fakeAuthCode(consent: FakeConsent): string {
  const scopes = consent.scopes.filter((s) => (FAKE_SCOPES as readonly string[]).includes(s));
  const json = JSON.stringify({ handle: consent.handle, scopes });
  return FAKE_CODE_PREFIX + Buffer.from(json, "utf8").toString("base64url");
}

export function parseFakeAuthCode(code: string): FakeConsent | null {
  if (!code.startsWith(FAKE_CODE_PREFIX)) return null;
  try {
    const raw: unknown = JSON.parse(
      Buffer.from(code.slice(FAKE_CODE_PREFIX.length), "base64url").toString("utf8"),
    );
    if (!raw || typeof raw !== "object") return null;
    const { handle, scopes } = raw as { handle?: unknown; scopes?: unknown };
    const valid = typeof handle === "string" ? normalizeFakeHandle(handle) : null;
    if (!valid || !Array.isArray(scopes)) return null;
    return {
      handle: valid,
      scopes: scopes.filter(
        (s): s is string => typeof s === "string" && (FAKE_SCOPES as readonly string[]).includes(s),
      ),
    };
  } catch {
    return null;
  }
}

/** The fake platform user id for a handle: the same handle always reconnects the same user. */
export function fakeUserId(handle: string): string {
  return FAKE_USER_PREFIX + handle;
}

function fakeHandleFromUserId(id: string | null): string | null {
  if (!id?.startsWith(FAKE_USER_PREFIX)) return null;
  return normalizeFakeHandle(id.slice(FAKE_USER_PREFIX.length));
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

  /** True when the store knows the video is 9:16 (Instagram's Reel shape). */
  async function isVertical(videoUrl: string): Promise<boolean> {
    const size = await store.videoSize?.(videoUrl);
    return !!size && size.height > 0 && Math.abs(size.width / size.height - 9 / 16) < 0.01;
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
      scopes: [...FAKE_SCOPES],
    };
  }

  return {
    platform: "fake",

    authorizeUrl({ state, redirectUri }) {
      // The fake consent screen (src/app/connect/fake), on the same site as the callback.
      const url = new URL(FAKE_CONSENT_PATH, redirectUri);
      url.searchParams.set("state", state);
      return url.toString();
    },

    exchangeCode({ code }) {
      const consent = parseFakeAuthCode(code);
      if (!consent) {
        // Like Instagram: only a code from the (fake) consent screen works.
        return Promise.reject(
          new ProviderError({
            code: "unknown",
            retryable: false,
            userMessage: "The Sandbox didn't accept the sign-in. Try connecting again.",
          }),
        );
      }
      return Promise.resolve({
        ...tokens(fakeUserId(consent.handle), code),
        scopes: consent.scopes,
      });
    },

    async refreshToken(ctx) {
      await guard(ctx);
      return tokens(ctx.platformUserId ?? fakeId("fake_user", ctx.accountId), ctx.accessToken);
    },

    async getProfile(ctx) {
      // Connecting: no fake account exists yet; the profile comes from the consent screen's user.
      const handle = fakeHandleFromUserId(ctx.platformUserId);
      if (handle && (!ctx.accountId || !(await store.getAccount(ctx.accountId)))) {
        return {
          platformUserId: fakeUserId(handle),
          handle,
          profileUrl: `${FAKE_PERMALINK_BASE}/${handle}`,
          followers: FAKE_NEW_FOLLOWERS_BASE + (hash32(handle) % 9000),
          accountType: "MEDIA_CREATOR",
          pictureUrl: null,
        };
      }
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
      if (c.mediaId) return { state: "published" };
      if (
        state.failureMode === "aspect_ratio" &&
        !(await isVertical(c.videoUrl)) &&
        (await fails(state, ["aspect_ratio"]))
      ) {
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
