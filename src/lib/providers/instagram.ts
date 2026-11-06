import { CONNECT_ERRORS, requiredScopes } from "@/lib/domain/connect";
import {
  ProviderError,
  type ContainerStatus,
  type Profile,
  type ProviderAccount,
  type PublishHint,
  type PublishedMedia,
  type PublishingQuota,
  type SocialProvider,
  type TokenSet,
} from "./types";

/**
 * The Instagram SocialProvider: "Instagram API with Instagram Login" (no Facebook Page needed).
 * The only module that talks to Instagram (CLAUDE.md → Conventions).
 *
 * BC-9 implements the connection: authorize URL, code → short-lived → long-lived token, token
 * refresh and the profile. BC-16 adds publishing Reels: the publishing quota, the container
 * (upload), its status, and media_publish. Stats (BC-17/BC-21) come later; until then
 * `getMediaInsights` fails with `unsupported`.
 *
 * Tokens travel only between this server and Instagram. Error messages never include a URL or a
 * token (request URLs carry `access_token` as a query parameter, as Instagram's docs do).
 */

export const IG_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const IG_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
export const IG_GRAPH = "https://graph.instagram.com";
export const IG_GRAPH_VERSION = "v23.0";
const PROFILE_FIELDS = "user_id,username,account_type,followers_count,profile_picture_url";
/** Long-lived tokens last 60 days; used when Instagram leaves expires_in out. */
const DEFAULT_TOKEN_SECONDS = 60 * 24 * 3600;
const TIMEOUT_MS = 15_000;
/** Instagram's documented limit of API-published posts per rolling 24 hours, if `config` is missing. */
export const IG_DEFAULT_QUOTA = 100;
const DEFAULT_QUOTA_SECONDS = 24 * 3600;
/** Recent posts searched for a container whose publish answer was lost. */
const RECENT_MEDIA_LIMIT = 25;
/** Clock skew allowed between our container time and Instagram's post timestamp. */
const RECOVERY_SKEW_MS = 5 * 60_000;
const CONTAINER_LIFETIME_MS = 24 * 3_600_000;

export interface InstagramConfig {
  appId: string;
  appSecret: string;
}

export interface InstagramProviderDeps {
  config: InstagramConfig;
  now: () => Date;
  /** Injected for tests; MSW intercepts the global fetch anyway. */
  fetch?: typeof fetch;
  /** Per-request timeout (default 15 s). */
  timeoutMs?: number;
}

/** IG_APP_ID + IG_APP_SECRET from the environment, or null when either is missing. */
export function instagramConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): InstagramConfig | null {
  const appId = env.IG_APP_ID?.trim();
  const appSecret = env.IG_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export const INSTAGRAM_NOT_CONFIGURED_MESSAGE = CONNECT_ERRORS.not_configured;

const errors = {
  network: () =>
    new ProviderError({
      code: "network",
      retryable: true,
      userMessage: "Couldn't reach Instagram. Try again in a few minutes.",
    }),
  tokenExpired: (detail?: string) =>
    new ProviderError({
      code: "token_expired",
      retryable: false,
      userMessage: "Instagram access expired. Reconnect the account to resume posting.",
      message: detail,
    }),
  rejected: (detail?: string) =>
    new ProviderError({
      code: "unknown",
      retryable: false,
      userMessage: "Instagram didn't accept the request. Try connecting again.",
      message: detail,
    }),
  rateLimited: (detail?: string) =>
    new ProviderError({
      code: "quota_exhausted",
      retryable: true,
      userMessage: "Instagram is limiting requests for this account. Try again in an hour.",
      message: detail,
    }),
  notConnected: () =>
    new ProviderError({
      code: "token_expired",
      retryable: false,
      userMessage:
        "Broadcast doesn't know this Instagram account's id. Reconnect it to resume posting.",
    }),
  noPermission: (detail?: string) =>
    new ProviderError({
      code: "token_expired",
      retryable: false,
      userMessage:
        "Broadcast isn't allowed to publish on this Instagram account. Reconnect it and allow publishing.",
      message: detail,
    }),
  unsupported: (what: string) =>
    new ProviderError({
      code: "unsupported",
      retryable: false,
      userMessage: `${what} through Instagram isn't available yet.`,
    }),
};

interface GraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_subtype?: number;
    error_user_msg?: string;
  };
  error_type?: string;
  error_message?: string;
  code?: number;
}

/**
 * What's wrong with a video, from Instagram's error subcode or message: the reasons the dashboard
 * shows (DESIGN.md → Copy: what went wrong and how to fix it). Null when it isn't about the video.
 */
export function mediaProblem(
  subcode: number | undefined,
  text: string,
  detail: string = text,
): ProviderError | null {
  const t = text.toLowerCase();
  if (subcode === 2207009 || t.includes("aspect ratio")) {
    return new ProviderError({
      code: "invalid_media",
      retryable: false,
      userMessage:
        "Instagram rejected the video's shape. Reels must be 9:16 (1080 × 1920); re-export it and add it again.",
      message: detail,
    });
  }
  if (/duration|too long|too short|length of the video/.test(t)) {
    return new ProviderError({
      code: "invalid_media",
      retryable: false,
      userMessage:
        "Instagram rejected the video's length. Reels must be between 3 seconds and 15 minutes (up to 90 seconds for full reach).",
      message: detail,
    });
  }
  if (subcode === 2207026 || /video format|file format|codec/.test(t)) {
    return new ProviderError({
      code: "invalid_media",
      retryable: false,
      userMessage:
        "Instagram couldn't read the video file. Export it as MP4 (H.264 video, AAC audio) and add it again.",
      message: detail,
    });
  }
  if (
    subcode === 2207003 ||
    subcode === 2207020 ||
    subcode === 2207052 ||
    /download|fetch|retriev/.test(t)
  ) {
    return new ProviderError({
      code: "network",
      retryable: true,
      userMessage: "Instagram couldn't download the video. Broadcast will upload it again.",
      message: detail,
    });
  }
  return null;
}

/** Maps an Instagram error response to a ProviderError. */
export function graphError(status: number, body: unknown): ProviderError {
  const b = (body ?? {}) as GraphErrorBody;
  const code = b.error?.code ?? b.code;
  const subcode = b.error?.error_subcode ?? b.error?.error_subtype;
  const message = b.error?.message ?? b.error_message ?? "no message";
  const detail = `Instagram ${status}: ${message}${subcode ? ` (${subcode})` : ""}`;
  if (code === 190 || (b.error?.type === "OAuthException" && status === 401)) {
    return errors.tokenExpired(detail);
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) {
    return errors.rateLimited(detail);
  }
  // "Maximum number of posts reached" (the 24-hour publishing limit).
  if (subcode === 2207042) {
    return new ProviderError({
      code: "quota_exhausted",
      retryable: true,
      userMessage:
        "This account has used its 24-hour Instagram publishing limit. Posting resumes when it frees up.",
      message: detail,
    });
  }
  // "Media not ready for publishing": the container is still processing.
  if (code === 9007 || subcode === 2207027) {
    return new ProviderError({
      code: "not_ready",
      retryable: true,
      userMessage: "Instagram is still processing the video. Broadcast will try again shortly.",
      message: detail,
    });
  }
  // Missing permission (instagram_business_content_publish not granted).
  if (code === 10 || code === 200) return errors.noPermission(detail);
  const media =
    status < 500
      ? mediaProblem(subcode, `${message} ${b.error?.error_user_msg ?? ""}`, detail)
      : null;
  if (media) return media;
  if (status >= 500) {
    return new ProviderError({
      code: "network",
      retryable: true,
      userMessage: "Instagram had a problem. Try again in a few minutes.",
      message: detail,
    });
  }
  return errors.rejected(detail);
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((s): s is string => typeof s === "string");
  if (typeof value === "string")
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

/**
 * JSON.parse that keeps Instagram's ids exact. The token endpoint sends `user_id` as a bare number
 * (e.g. 17841405822304914), which is beyond 2^53 and would lose its last digits as a JS number;
 * id fields are turned into strings before parsing.
 */
export function parseGraphJson(text: string): unknown {
  return JSON.parse(text.replace(/("(?:user_id|id)"\s*:\s*)(-?\d+)(?=\s*[,}\]])/g, '$1"$2"'));
}

/** Instagram timestamps look like 2026-11-06T10:00:00+0000. Epoch ms, or null. */
function parseGraphTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(t) ? null : t;
}

export function createInstagramProvider(deps: InstagramProviderDeps): SocialProvider {
  // Looked up per call (not captured once), so test interceptors installed later still apply.
  const doFetch: typeof fetch = (input, init) => (deps.fetch ?? globalThis.fetch)(input, init);
  const { appId, appSecret } = deps.config;

  async function call(url: URL | string, init?: RequestInit): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await doFetch(url, {
        ...init,
        signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
      });
    } catch {
      throw errors.network();
    }
    let body: unknown = null;
    try {
      body = parseGraphJson(await res.text());
    } catch {
      // Not JSON: handled below.
    }
    if (!res.ok) throw graphError(res.status, body);
    if (!body || typeof body !== "object") throw errors.rejected("Instagram sent no JSON body.");
    return body as Record<string, unknown>;
  }

  function graphUrl(path: string, params: Record<string, string>): URL {
    const url = new URL(path, IG_GRAPH);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url;
  }

  function expiry(expiresIn: unknown): Date {
    const seconds =
      typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : DEFAULT_TOKEN_SECONDS;
    return new Date(deps.now().getTime() + seconds * 1000);
  }

  async function getProfile(account: ProviderAccount): Promise<Profile> {
    const res = await call(
      graphUrl(`/${IG_GRAPH_VERSION}/me`, {
        fields: PROFILE_FIELDS,
        access_token: account.accessToken,
      }),
    );
    const platformUserId = asString(res.user_id) ?? asString(res.id) ?? account.platformUserId;
    const handle = asString(res.username);
    if (!platformUserId || !handle) throw errors.rejected("Profile without an id or username.");
    const followers = typeof res.followers_count === "number" ? res.followers_count : 0;
    return {
      platformUserId,
      handle,
      profileUrl: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
      followers: Math.max(0, Math.round(followers)),
      accountType: asString(res.account_type),
      pictureUrl: asString(res.profile_picture_url),
    };
  }

  /** POST with form parameters (the caption can be long; it doesn't belong in the URL). */
  function post(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    return call(new URL(path, IG_GRAPH), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
  }

  function userId(account: ProviderAccount): string {
    if (!account.platformUserId) throw errors.notConnected();
    return account.platformUserId;
  }

  async function containerStatus(
    account: ProviderAccount,
    containerId: string,
  ): Promise<ContainerStatus> {
    const res = await call(
      graphUrl(`/${IG_GRAPH_VERSION}/${encodeURIComponent(containerId)}`, {
        fields: "status_code,status",
        access_token: account.accessToken,
      }),
    );
    const code = asString(res.status_code);
    const text = asString(res.status) ?? "";
    switch (code) {
      case "IN_PROGRESS":
        return { state: "in_progress" };
      case "FINISHED":
        return { state: "finished" };
      case "PUBLISHED":
        return { state: "published" };
      case "EXPIRED":
        // Not published within 24 hours. A fresh upload fixes it.
        return {
          state: "error",
          error: new ProviderError({
            code: "network",
            retryable: true,
            userMessage:
              "Instagram's copy of the video expired before it was published. Broadcast will upload it again.",
            message: `Container ${containerId} EXPIRED: ${text}`,
          }),
        };
      case "ERROR":
        return {
          state: "error",
          error:
            mediaProblem(
              Number(/\b(22\d{5})\b/.exec(text)?.[1]) || undefined,
              text,
              `Container ${containerId} ERROR: ${text}`,
            ) ??
            new ProviderError({
              code: "invalid_media",
              retryable: false,
              userMessage: text
                ? `Instagram couldn't process the video: ${text.replace(/^Error:\s*/i, "")}`
                : "Instagram couldn't process the video. Check it plays and is a 9:16 MP4, then add it again.",
              message: `Container ${containerId} ERROR: ${text}`,
            }),
        };
      default:
        throw errors.rejected(
          `Container ${containerId}: unexpected status_code ${code ?? "none"}.`,
        );
    }
  }

  async function permalinkOf(account: ProviderAccount, mediaId: string): Promise<string | null> {
    try {
      const res = await call(
        graphUrl(`/${IG_GRAPH_VERSION}/${encodeURIComponent(mediaId)}`, {
          fields: "permalink",
          access_token: account.accessToken,
        }),
      );
      return asString(res.permalink);
    } catch {
      // The post is live either way; a missing link mustn't make anyone publish it again.
      return null;
    }
  }

  /**
   * Finds the post an already-published container became: Instagram doesn't link a container to
   * its media, so look through the account's recent Reels for the same caption, posted no earlier
   * than the container was made. The oldest match wins.
   */
  async function findPublished(
    account: ProviderAccount,
    hint: PublishHint | undefined,
  ): Promise<PublishedMedia> {
    const none: PublishedMedia = { mediaId: null, permalink: null };
    // Without the container's time a match could be an older post with the same caption.
    if (!hint?.containerCreatedAt) return none;
    let res: Record<string, unknown>;
    try {
      res = await call(
        graphUrl(`/${IG_GRAPH_VERSION}/${userId(account)}/media`, {
          fields: "id,caption,permalink,timestamp,media_product_type",
          limit: String(RECENT_MEDIA_LIMIT),
          access_token: account.accessToken,
        }),
      );
    } catch {
      return none;
    }
    const since = hint.containerCreatedAt.getTime() - RECOVERY_SKEW_MS;
    // A container can only be published within 24 hours of being made.
    const until = hint.containerCreatedAt.getTime() + CONTAINER_LIFETIME_MS + RECOVERY_SKEW_MS;
    const items = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
    const matches = items
      .map((m) => ({
        id: asString(m.id),
        caption: typeof m.caption === "string" ? m.caption : "",
        permalink: asString(m.permalink),
        at: parseGraphTime(m.timestamp),
        type: asString(m.media_product_type),
      }))
      .filter(
        (m) =>
          m.id &&
          (m.type === null || m.type === "REELS") &&
          m.caption.trim() === hint.caption.trim() &&
          m.at !== null &&
          m.at >= since &&
          m.at <= until,
      )
      .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    const found = matches[0];
    return found ? { mediaId: found.id, permalink: found.permalink } : none;
  }

  return {
    platform: "instagram",

    authorizeUrl({ state, redirectUri }) {
      const url = new URL(IG_AUTHORIZE_URL);
      url.searchParams.set("client_id", appId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", requiredScopes("instagram").join(","));
      url.searchParams.set("state", state);
      // Instagram Login only (no "Continue with Facebook").
      url.searchParams.set("enable_fb_login", "0");
      return url.toString();
    },

    async exchangeCode({ code, redirectUri }): Promise<TokenSet> {
      // Instagram appends "#_" to the code in the redirect; it isn't part of the code.
      const cleanCode = code.replace(/#_$/, "");
      const short = await call(IG_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: appId,
          client_secret: appSecret,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code: cleanCode,
        }),
      });
      // Documented shape: { data: [{ access_token, user_id, permissions }] }; older apps get it flat.
      const entry =
        (Array.isArray(short.data)
          ? (short.data[0] as Record<string, unknown> | undefined)
          : short) ?? {};
      const shortToken = asString(entry.access_token);
      const userId = asString(entry.user_id);
      if (!shortToken || !userId) throw errors.rejected("Token response without token or user.");
      // Instagram lists what was granted; if a response ever leaves the field out, assume what was
      // asked for rather than flag a fully authorised account (a later call would fail clearly).
      const scopes =
        entry.permissions === undefined
          ? requiredScopes("instagram")
          : parseScopes(entry.permissions);

      const long = await call(
        graphUrl("/access_token", {
          grant_type: "ig_exchange_token",
          client_secret: appSecret,
          access_token: shortToken,
        }),
      );
      const accessToken = asString(long.access_token);
      if (!accessToken) throw errors.rejected("Long-lived token response without a token.");
      return { accessToken, expiresAt: expiry(long.expires_in), platformUserId: userId, scopes };
    },

    async refreshToken(account: ProviderAccount): Promise<TokenSet> {
      const res = await call(
        graphUrl("/refresh_access_token", {
          grant_type: "ig_refresh_token",
          access_token: account.accessToken,
        }),
      );
      const accessToken = asString(res.access_token);
      if (!accessToken) throw errors.rejected("Refresh response without a token.");
      return {
        accessToken,
        expiresAt: expiry(res.expires_in),
        platformUserId: account.platformUserId ?? "",
        // Instagram includes the permissions only sometimes; empty means "unchanged".
        scopes: parseScopes(res.permissions),
      };
    },

    getProfile,

    async getFollowerCount(account) {
      return (await getProfile(account)).followers;
    },

    async getPublishingQuota(account): Promise<PublishingQuota> {
      const res = await call(
        graphUrl(`/${IG_GRAPH_VERSION}/${userId(account)}/content_publishing_limit`, {
          fields: "quota_usage,config",
          access_token: account.accessToken,
        }),
      );
      const entry = (Array.isArray(res.data) ? res.data[0] : null) as
        | { quota_usage?: unknown; config?: { quota_total?: unknown; quota_duration?: unknown } }
        | null
        | undefined;
      if (!entry || typeof entry.quota_usage !== "number") {
        throw errors.rejected("Publishing limit response without quota_usage.");
      }
      const total = entry.config?.quota_total;
      const seconds = entry.config?.quota_duration;
      return {
        used: entry.quota_usage,
        limit: typeof total === "number" ? total : IG_DEFAULT_QUOTA,
        windowHours: Math.round(
          (typeof seconds === "number" && seconds > 0 ? seconds : DEFAULT_QUOTA_SECONDS) / 3600,
        ),
      };
    },

    async createReelContainer(account, { videoUrl, caption }) {
      const res = await post(`/${IG_GRAPH_VERSION}/${userId(account)}/media`, {
        media_type: "REELS",
        video_url: videoUrl,
        caption,
        share_to_feed: "true",
        access_token: account.accessToken,
      });
      const containerId = asString(res.id);
      if (!containerId) throw errors.rejected("Container response without an id.");
      return { containerId };
    },

    getContainerStatus: containerStatus,

    async publishContainer(account, containerId, hint): Promise<PublishedMedia> {
      // A container is published at most once: if it already was (a lost answer), find that post.
      const before = await containerStatus(account, containerId);
      if (before.state === "published") return findPublished(account, hint);
      if (before.state === "in_progress") {
        throw new ProviderError({
          code: "not_ready",
          retryable: true,
          userMessage: "Instagram is still processing the video. Broadcast will try again shortly.",
        });
      }
      if (before.state === "error") throw before.error;

      let res: Record<string, unknown>;
      try {
        res = await post(`/${IG_GRAPH_VERSION}/${userId(account)}/media_publish`, {
          creation_id: containerId,
          access_token: account.accessToken,
        });
      } catch (err) {
        // The call may have gone through even though it failed here (a timeout): ask again.
        const after = await containerStatus(account, containerId).catch(() => null);
        if (after?.state === "published") return findPublished(account, hint);
        throw err;
      }
      const mediaId = asString(res.id);
      if (!mediaId) {
        // Instagram accepted it; without an id, find the post the same way as after a lost answer.
        return findPublished(account, hint);
      }
      return { mediaId, permalink: await permalinkOf(account, mediaId) };
    },
    getMediaInsights() {
      return Promise.reject(errors.unsupported("Collecting stats"));
    },
  };
}
