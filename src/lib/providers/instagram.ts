import { createHmac } from "node:crypto";
import { CONNECT_ERRORS } from "@/lib/domain/connect";
import {
  ProviderError,
  type SharedAccount,
  type ContainerStatus,
  type MediaInsights,
  type Profile,
  type ProviderAccount,
  type PublishHint,
  type PublishedMedia,
  type PublishingQuota,
  type SocialProvider,
  type TokenSet,
} from "./types";

/**
 * The Instagram SocialProvider: "Instagram API with Facebook Login", signed in through Facebook
 * Login for Business with a saved configuration (Meta's "API setup with Unified login"; ADR 0006).
 * The only module that talks to Meta (CLAUDE.md → Conventions).
 *
 * Connection (BC-9, BC-23): the login dialog with `config_id`, code → short-lived user token →
 * long-lived (60-day) user token, then `debug_token` for the granted permissions, the expiry and
 * the Instagram accounts the person shared, plus `/me/accounts` (Pages → instagram_business_account)
 * as a second source. Facebook doesn't renew long-lived user tokens for a server, so
 * `refreshToken` says `not_renewable` and the scheduler asks for a reconnect before expiry.
 * Publishing (BC-16) and stats (BC-21) use the same endpoints as before, on graph.facebook.com.
 *
 * Tokens travel only between this server and Meta. Error messages never include a URL or a token
 * (request URLs carry `access_token` as a query parameter, as Meta's docs do). Every call with a
 * user token also sends `appsecret_proof`, so the app can require it ("Require app secret").
 */

export const IG_GRAPH_VERSION = "v25.0";
export const IG_AUTHORIZE_URL = `https://www.facebook.com/${IG_GRAPH_VERSION}/dialog/oauth`;
export const IG_GRAPH = "https://graph.facebook.com";
const PROFILE_FIELDS = "id,username,followers_count,profile_picture_url";
/** Long-lived user tokens last about 60 days; used when Meta leaves the expiry out. */
const DEFAULT_TOKEN_SECONDS = 60 * 24 * 3600;
/** The permission whose granted targets are the Instagram accounts the person shared. */
const ACCOUNT_SCOPE = "instagram_basic";
const TIMEOUT_MS = 15_000;
/** Instagram's documented limit of API-published posts per rolling 24 hours, if `config` is missing. */
export const IG_DEFAULT_QUOTA = 100;
const DEFAULT_QUOTA_SECONDS = 24 * 3600;
/** Recent posts searched for a container whose publish answer was lost. */
const RECENT_MEDIA_LIMIT = 25;
/** Clock skew allowed between our container time and Instagram's post timestamp. */
const RECOVERY_SKEW_MS = 5 * 60_000;
const CONTAINER_LIFETIME_MS = 24 * 3_600_000;
/** The post metrics Broadcast stores, by Instagram's metric name. */
export const IG_INSIGHT_METRICS = {
  views: "views",
  reach: "reach",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  saves: "saved",
} as const satisfies Record<keyof MediaInsights, string>;

export interface InstagramConfig {
  /** The Meta app's App ID (App settings → Basic). */
  appId: string;
  /** The Meta app's App secret. Server only. */
  appSecret: string;
  /** The Facebook Login for Business configuration's id (IG_LOGIN_CONFIG_ID). */
  loginConfigId: string;
}

export interface InstagramProviderDeps {
  config: InstagramConfig;
  now: () => Date;
  /** Injected for tests; MSW intercepts the global fetch anyway. */
  fetch?: typeof fetch;
  /** Per-request timeout (default 15 s). */
  timeoutMs?: number;
}

/** IG_APP_ID + IG_APP_SECRET + IG_LOGIN_CONFIG_ID from the environment, or null when one is missing. */
export function instagramConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): InstagramConfig | null {
  const appId = env.IG_APP_ID?.trim();
  const appSecret = env.IG_APP_SECRET?.trim();
  const loginConfigId = env.IG_LOGIN_CONFIG_ID?.trim();
  if (!appId || !appSecret || !loginConfigId) return null;
  return { appId, appSecret, loginConfigId };
}

/** HMAC-SHA256 of the token with the app secret, hex (Meta's `appsecret_proof`). */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

/** refreshToken's answer: Facebook doesn't renew a long-lived user token for a server. */
export const NOT_RENEWABLE = "Facebook doesn't let Broadcast renew Instagram access on its own.";

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
  notRenewable: () =>
    new ProviderError({
      code: "not_renewable",
      retryable: false,
      userMessage: `${NOT_RENEWABLE} Reconnect the account to keep posting.`,
    }),
  mediaGone: () =>
    new ProviderError({
      code: "not_found",
      retryable: false,
      userMessage: "Instagram no longer has this post, so it has no stats.",
    }),
};

/** "Unsupported get request" (100/33): the object doesn't exist (e.g. a deleted post). */
function isDeletedMedia(err: unknown): boolean {
  return err instanceof ProviderError && /^Instagram 400: .*\(33\)$/.test(err.message);
}

/** Error 100 about a metric: it isn't available for this media type. */
function isUnsupportedMetric(err: unknown): boolean {
  return (
    err instanceof ProviderError &&
    err.code !== "token_expired" &&
    /^Instagram 400: .*\bmetric/i.test(err.message)
  );
}

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
  // Missing permission (instagram_content_publish or pages_read_engagement not granted).
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
  return JSON.parse(
    text
      .replace(/("(?:user_id|id)"\s*:\s*)(-?\d+)(?=\s*[,}\]])/g, '$1"$2"')
      // debug_token's granular_scopes list target ids (Pages, Instagram accounts) as numbers.
      .replace(
        /("target_ids"\s*:\s*\[)([^\]]*)\]/g,
        (_m, head: string, inner: string) =>
          `${head}${inner
            .split(",")
            .map((v) => (/^\s*-?\d+\s*$/.test(v) ? `"${v.trim()}"` : v))
            .join(",")}]`,
      ),
  );
}

interface DebugToken {
  scopes: string[];
  granular: { scope: string; targets: string[] | null }[];
  /** Epoch ms; "never" when Meta says 0; null when it doesn't say. */
  expiresAt: number | "never" | null;
  dataAccessExpiresAt: number | null;
}

/** Reads debug_token's `data` (unix seconds; 0 means "never"). */
export function parseDebugToken(data: Record<string, unknown>): DebugToken {
  const seconds = (v: unknown) => (typeof v === "number" && v > 0 ? v * 1000 : null);
  const expiresAt: DebugToken["expiresAt"] =
    data.expires_at === 0 ? "never" : seconds(data.expires_at);
  const granularRaw = Array.isArray(data.granular_scopes) ? data.granular_scopes : [];
  return {
    scopes: parseScopes(data.scopes),
    granular: granularRaw
      .filter((g): g is Record<string, unknown> => !!g && typeof g === "object")
      .map((g) => ({
        scope: typeof g.scope === "string" ? g.scope : "",
        targets: Array.isArray(g.target_ids)
          ? g.target_ids.map(asString).filter((t): t is string => t !== null)
          : null,
      }))
      .filter((g) => g.scope),
    expiresAt,
    dataAccessExpiresAt: seconds(data.data_access_expires_at),
  };
}

/**
 * The permissions granted for one Instagram account. A permission limited to some targets
 * (granular scopes) counts only when it covers this account: Instagram permissions by account id,
 * Pages permissions by the Page the account is linked to (`pageOf`, from /me/accounts; when the
 * Page isn't known the Pages permission is kept, and a refusal shows at publish time).
 */
export function scopesForAccount(
  debug: DebugToken,
  igUserId: string,
  pageOf: ReadonlyMap<string, string> = new Map(),
): string[] {
  const page = pageOf.get(igUserId);
  return debug.scopes.filter((scope) => {
    const g = debug.granular.find((x) => x.scope === scope);
    if (!g?.targets || g.targets.length === 0) return true;
    if (scope.startsWith("instagram_")) return g.targets.includes(igUserId);
    if (scope.startsWith("pages_") && page) return g.targets.includes(page);
    return true;
  });
}

/** Instagram timestamps look like 2026-11-06T10:00:00+0000. Epoch ms, or null. */
function parseGraphTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(t) ? null : t;
}

/** One insight's value: `values[0].value` (media insights) or `total_value.value`. */
function insightValue(entry: Record<string, unknown>): number | null {
  const values = entry.values;
  const first: unknown = Array.isArray(values) ? values[0] : undefined;
  const fromValues =
    first && typeof first === "object" ? (first as { value?: unknown }).value : undefined;
  const total = entry.total_value;
  const value =
    fromValues ??
    (total && typeof total === "object" ? (total as { value?: unknown }).value : undefined);
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null;
}

/**
 * Maps Instagram's insights `data` array to MediaInsights. A metric Instagram leaves out (it
 * doesn't report it for this media type) is null, never 0.
 */
export function parseInsights(data: readonly unknown[]): MediaInsights {
  const byName = new Map<string, number | null>();
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.name === "string") byName.set(e.name, insightValue(e));
  }
  const pick = (name: string) => byName.get(name) ?? null;
  return {
    views: pick(IG_INSIGHT_METRICS.views),
    reach: pick(IG_INSIGHT_METRICS.reach),
    likes: pick(IG_INSIGHT_METRICS.likes),
    comments: pick(IG_INSIGHT_METRICS.comments),
    shares: pick(IG_INSIGHT_METRICS.shares),
    saves: pick(IG_INSIGHT_METRICS.saves),
  };
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

  /** Adds appsecret_proof next to a user access token. */
  function withProof(params: Record<string, string>): Record<string, string> {
    const token = params.access_token;
    return token && !token.includes("|")
      ? { ...params, appsecret_proof: appSecretProof(token, appSecret) }
      : params;
  }

  function graphUrl(path: string, params: Record<string, string>): URL {
    const url = new URL(path, IG_GRAPH);
    for (const [k, v] of Object.entries(withProof(params))) url.searchParams.set(k, v);
    return url;
  }

  function expiry(expiresIn: unknown): Date {
    const seconds =
      typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : DEFAULT_TOKEN_SECONDS;
    return new Date(deps.now().getTime() + seconds * 1000);
  }

  function userId(account: ProviderAccount): string {
    if (!account.platformUserId) throw errors.notConnected();
    return account.platformUserId;
  }

  /**
   * The Instagram professional account's profile (GET /{ig-user-id}). Only professional accounts
   * (business or creator) can be reached through Facebook Login, so there is no account type.
   */
  async function getProfile(account: ProviderAccount): Promise<Profile> {
    const id = userId(account);
    const res = await call(
      graphUrl(`/${IG_GRAPH_VERSION}/${encodeURIComponent(id)}`, {
        fields: PROFILE_FIELDS,
        access_token: account.accessToken,
      }),
    );
    const platformUserId = asString(res.id) ?? id;
    const handle = asString(res.username);
    if (!handle) throw errors.rejected("Profile without a username.");
    const followers = typeof res.followers_count === "number" ? res.followers_count : 0;
    return {
      platformUserId,
      handle,
      profileUrl: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
      followers: Math.max(0, Math.round(followers)),
      accountType: null,
      pictureUrl: asString(res.profile_picture_url),
    };
  }

  /** POST with form parameters (the caption can be long; it doesn't belong in the URL). */
  function post(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    return call(new URL(path, IG_GRAPH), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(withProof(params)),
    });
  }

  /** GET /oauth/access_token (the code exchange and the long-lived exchange). */
  async function tokenCall(
    params: Record<string, string>,
  ): Promise<{ token: string; expiresIn: unknown }> {
    const url = new URL(`/${IG_GRAPH_VERSION}/oauth/access_token`, IG_GRAPH);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await call(url);
    const token = asString(res.access_token);
    if (!token) throw errors.rejected("Token response without a token.");
    return { token, expiresIn: res.expires_in };
  }

  /**
   * The Instagram accounts linked to the Pages the person shared (needs pages_show_list), as
   * Instagram account id → Page id.
   */
  async function pageAccounts(accessToken: string): Promise<Map<string, string>> {
    let res: Record<string, unknown>;
    try {
      res = await call(
        graphUrl(`/${IG_GRAPH_VERSION}/me/accounts`, {
          fields: "id,instagram_business_account{id}",
          limit: "100",
          access_token: accessToken,
        }),
      );
    } catch (err) {
      // A missing Pages permission only means this source is empty: debug_token may still list
      // the accounts, and the permission check reports what's missing.
      if (
        err instanceof ProviderError &&
        (err.code === "network" || err.code === "quota_exhausted")
      )
        throw err;
      return new Map();
    }
    const pages = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
    const linked = new Map<string, string>();
    for (const p of pages) {
      const ig = p.instagram_business_account;
      const igId = ig && typeof ig === "object" ? asString((ig as { id?: unknown }).id) : null;
      const pageId = asString(p.id);
      if (igId && pageId && !linked.has(igId)) linked.set(igId, pageId);
    }
    return linked;
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
      // Facebook Login for Business: the configuration (config_id) sets the token type, the assets
      // and the permissions, so no `scope`. A code comes back (the server swaps it for a token).
      const url = new URL(IG_AUTHORIZE_URL);
      url.searchParams.set("client_id", appId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("config_id", deps.config.loginConfigId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("override_default_response_type", "true");
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeCode({ code, redirectUri }): Promise<TokenSet> {
      const short = await tokenCall({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code,
      });
      const long = await tokenCall({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: short.token,
      });
      const accessToken = long.token;

      // What the token can do and for which accounts. The app token (id|secret) stays on the server.
      const [debugRes, pageOf] = await Promise.all([
        call(
          graphUrl(`/${IG_GRAPH_VERSION}/debug_token`, {
            input_token: accessToken,
            access_token: `${appId}|${appSecret}`,
          }),
        ),
        pageAccounts(accessToken),
      ]);
      const data = (debugRes.data ?? {}) as Record<string, unknown>;
      if (data.is_valid === false) throw errors.rejected("debug_token says the token isn't valid.");
      if (asString(data.app_id) && asString(data.app_id) !== appId) {
        throw errors.rejected("The token belongs to another app.");
      }
      const debug = parseDebugToken(data);

      const fromGrants = debug.granular.find((g) => g.scope === ACCOUNT_SCOPE)?.targets ?? [];
      const ids = [...new Set([...fromGrants, ...pageOf.keys()])];
      const accounts: SharedAccount[] = ids.map((platformUserId) => ({
        platformUserId,
        scopes: scopesForAccount(debug, platformUserId, pageOf),
      }));

      // The earliest end: the token's (debug_token, else expires_in, else 60 days; none when Meta
      // says it never expires) and the app's data access.
      const tokenEnd =
        debug.expiresAt === "never" ? null : (debug.expiresAt ?? expiry(long.expiresIn).getTime());
      const ends = [tokenEnd, debug.dataAccessExpiresAt].filter((t): t is number => t !== null);
      if (ends.length === 0) ends.push(expiry(undefined).getTime());
      return {
        accessToken,
        expiresAt: new Date(Math.min(...ends)),
        platformUserId: accounts[0]?.platformUserId ?? "",
        scopes: accounts[0]?.scopes ?? debug.scopes,
        accounts,
      };
    },

    refreshToken(): Promise<TokenSet> {
      // A long-lived user token can't be renewed by a server: only a new login gives a new one.
      return Promise.reject(errors.notRenewable());
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
    async getMediaInsights(account, mediaId): Promise<MediaInsights> {
      const insights = (metrics: readonly string[]) =>
        call(
          graphUrl(`/${IG_GRAPH_VERSION}/${encodeURIComponent(mediaId)}/insights`, {
            metric: metrics.join(","),
            access_token: account.accessToken,
          }),
        ).then((res) => {
          if (!Array.isArray(res.data)) throw errors.rejected("Insights response without data.");
          return res.data as unknown[];
        });
      try {
        return parseInsights(await insights(Object.values(IG_INSIGHT_METRICS)));
      } catch (err) {
        if (isDeletedMedia(err)) throw errors.mediaGone();
        if (!isUnsupportedMetric(err)) throw err;
      }
      // Instagram refuses the whole request when one metric doesn't apply to this media type:
      // ask for each metric on its own and leave out (null) the ones it refuses.
      const data: unknown[] = [];
      for (const metric of Object.values(IG_INSIGHT_METRICS)) {
        try {
          data.push(...(await insights([metric])));
        } catch (err) {
          if (!isUnsupportedMetric(err)) throw err;
        }
      }
      return parseInsights(data);
    },
  };
}
