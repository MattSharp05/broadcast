import { CONNECT_ERRORS, requiredScopes } from "@/lib/domain/connect";
import {
  ProviderError,
  type Profile,
  type ProviderAccount,
  type SocialProvider,
  type TokenSet,
} from "./types";

/**
 * The Instagram SocialProvider: "Instagram API with Instagram Login" (no Facebook Page needed).
 * The only module that talks to Instagram (CLAUDE.md → Conventions).
 *
 * BC-9 implements the connection: authorize URL, code → short-lived → long-lived token, token
 * refresh and the profile. Publishing (BC-16) and stats (BC-17) come later; until then those
 * calls fail with `unsupported`.
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

export interface InstagramConfig {
  appId: string;
  appSecret: string;
}

export interface InstagramProviderDeps {
  config: InstagramConfig;
  now: () => Date;
  /** Injected for tests; MSW intercepts the global fetch anyway. */
  fetch?: typeof fetch;
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
  unsupported: (what: string) =>
    new ProviderError({
      code: "unsupported",
      retryable: false,
      userMessage: `${what} through Instagram isn't available yet.`,
    }),
};

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subtype?: number };
  error_type?: string;
  error_message?: string;
  code?: number;
}

/** Maps an Instagram error response to a ProviderError. */
export function graphError(status: number, body: unknown): ProviderError {
  const b = (body ?? {}) as GraphErrorBody;
  const code = b.error?.code ?? b.code;
  const detail = `Instagram ${status}: ${b.error?.message ?? b.error_message ?? "no message"}`;
  if (code === 190 || (b.error?.type === "OAuthException" && status === 401)) {
    return errors.tokenExpired(detail);
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) {
    return errors.rateLimited(detail);
  }
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

export function createInstagramProvider(deps: InstagramProviderDeps): SocialProvider {
  // Looked up per call (not captured once), so test interceptors installed later still apply.
  const doFetch: typeof fetch = (input, init) => (deps.fetch ?? globalThis.fetch)(input, init);
  const { appId, appSecret } = deps.config;

  async function call(url: URL | string, init?: RequestInit): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
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

    getPublishingQuota() {
      return Promise.reject(errors.unsupported("Checking the publishing limit"));
    },
    createReelContainer() {
      return Promise.reject(errors.unsupported("Publishing"));
    },
    getContainerStatus() {
      return Promise.reject(errors.unsupported("Publishing"));
    },
    publishContainer() {
      return Promise.reject(errors.unsupported("Publishing"));
    },
    getMediaInsights() {
      return Promise.reject(errors.unsupported("Collecting stats"));
    },
  };
}
