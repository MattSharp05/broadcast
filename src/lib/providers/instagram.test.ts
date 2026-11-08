import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectionStatus } from "@/lib/domain/connect";
import {
  FIXTURE_APP,
  FIXTURE_CODE,
  FIXTURE_IG_USER,
  FIXTURE_REDIRECT_URI,
  FIXTURE_TOKENS,
  GRAPH,
  fixtures,
  instagramHandlers,
} from "../../../tests/fixtures/instagram/handlers";
import { publishFixtures } from "../../../tests/fixtures/instagram/publish/server";
import {
  FULL_MEDIA,
  NO_SHARES_MEDIA,
  RATE_LIMITED_MEDIA,
  SHARES_REFUSED_MEDIA,
  statsHandlers,
} from "../../../tests/fixtures/instagram/stats/server";
import {
  IG_DEFAULT_QUOTA,
  IG_GRAPH_VERSION,
  appSecretProof,
  createInstagramProvider,
  graphError,
  mediaProblem,
  instagramConfigFromEnv,
  parseGraphJson,
  parseInsights,
} from "./instagram";
import { ProviderError, type ProviderAccount } from "./types";

const server = setupServer(...instagramHandlers);
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
const provider = createInstagramProvider({ config: FIXTURE_APP, now: () => NOW });
const account: ProviderAccount = {
  accountId: "acc-1",
  platformUserId: FIXTURE_IG_USER.id,
  accessToken: FIXTURE_TOKENS.long,
};

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ProviderError) return e;
    throw e;
  }
  throw new Error("expected the call to fail");
}

describe("instagram: authorizeUrl", () => {
  it("opens Facebook Login for Business with the configuration, state and redirect", () => {
    const url = new URL(
      provider.authorizeUrl({ state: "state-123", redirectUri: FIXTURE_REDIRECT_URI }),
    );
    expect(url.origin + url.pathname).toBe(
      `https://www.facebook.com/${IG_GRAPH_VERSION}/dialog/oauth`,
    );
    expect(url.searchParams.get("client_id")).toBe(FIXTURE_APP.appId);
    expect(url.searchParams.get("config_id")).toBe(FIXTURE_APP.loginConfigId);
    expect(url.searchParams.get("redirect_uri")).toBe(FIXTURE_REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-123");
    // The configuration sets the permissions; `scope` isn't used with config_id.
    expect(url.searchParams.has("scope")).toBe(false);
    // The app secret never goes to the browser.
    expect(url.toString()).not.toContain(FIXTURE_APP.appSecret);
  });
});

describe("instagram: exchangeCode", () => {
  const exchange = () =>
    provider.exchangeCode({ code: FIXTURE_CODE, redirectUri: FIXTURE_REDIRECT_URI });

  it("swaps the code for a short-lived, then a 60-day user token, and finds the account", async () => {
    const tokens = await exchange();
    expect(tokens.accessToken).toBe(FIXTURE_TOKENS.long);
    expect(tokens.platformUserId).toBe(FIXTURE_IG_USER.id);
    expect(tokens.accounts).toEqual([
      { platformUserId: FIXTURE_IG_USER.id, scopes: fixtures.debugToken.data.scopes },
    ]);
    expect(connectionStatus({ platform: "instagram", grantedScopes: tokens.scopes })).toEqual({
      status: "ready",
      reason: null,
    });
    // debug_token's expires_at (60 days), which is before data access expires (90 days).
    expect(tokens.expiresAt.getTime()).toBe(fixtures.debugToken.data.expires_at * 1000);
    expect(tokens.expiresAt.getTime() - NOW.getTime()).toBe(
      fixtures.longLivedToken.expires_in * 1000,
    );
  });

  it("uses the earlier of the token's and the data access expiry", async () => {
    server.use(
      http.get(`${GRAPH}/:version/debug_token`, () =>
        HttpResponse.json({
          data: {
            ...fixtures.debugToken.data,
            expires_at: 0,
            data_access_expires_at: NOW.getTime() / 1000 + 86_400,
          },
        }),
      ),
    );
    expect((await exchange()).expiresAt.getTime()).toBe(NOW.getTime() + 86_400_000);
  });

  it("a token Meta says never expires ends when data access does", async () => {
    server.use(
      http.get(`${GRAPH}/:version/debug_token`, () =>
        HttpResponse.json({ data: { ...fixtures.debugToken.data, expires_at: 0 } }),
      ),
    );
    expect((await exchange()).expiresAt.getTime()).toBe(
      fixtures.debugToken.data.data_access_expires_at * 1000,
    );
  });

  it("a Pages permission granted on another Page doesn't count for this account", async () => {
    server.use(
      http.get(`${GRAPH}/:version/debug_token`, () =>
        HttpResponse.json({
          data: {
            ...fixtures.debugToken.data,
            granular_scopes: fixtures.debugToken.data.granular_scopes.map((g) =>
              g.scope === "pages_read_engagement" ? { ...g, target_ids: ["555"] } : g,
            ),
          },
        }),
      ),
    );
    const tokens = await exchange();
    expect(tokens.scopes).not.toContain("pages_read_engagement");
    expect(
      connectionStatus({ platform: "instagram", grantedScopes: tokens.scopes }).reason,
    ).toMatch(/^Publishing permission/);
  });

  it("finds accounts from the shared Pages when the grants name none", async () => {
    server.use(
      http.get(`${GRAPH}/:version/debug_token`, () =>
        HttpResponse.json({ data: { ...fixtures.debugToken.data, granular_scopes: [] } }),
      ),
    );
    const tokens = await exchange();
    expect(tokens.accounts?.map((a) => a.platformUserId)).toEqual([FIXTURE_IG_USER.id]);
  });

  it("lists every shared account once, ids exact even as bare numbers", async () => {
    server.use(
      http.get(`${GRAPH}/:version/debug_token`, () =>
        HttpResponse.text(
          JSON.stringify({ data: { ...fixtures.debugToken.data, granular_scopes: [] } }).replace(
            '"granular_scopes":[]',
            '"granular_scopes":[{"scope":"instagram_basic","target_ids":[17841400000000001,17841400000000002]},{"scope":"instagram_content_publish","target_ids":[17841400000000002]}]',
          ),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const tokens = await exchange();
    expect(tokens.accounts?.map((a) => a.platformUserId)).toEqual([
      "17841400000000001",
      "17841400000000002",
    ]);
    // Publishing was granted for the second account only.
    const first = tokens.accounts?.[0]?.scopes ?? [];
    expect(first).not.toContain("instagram_content_publish");
    expect(tokens.accounts?.[1]?.scopes).toContain("instagram_content_publish");
  });

  it("no Instagram account shared: an empty list, for the callback to explain", async () => {
    server.use(
      http.get(`${GRAPH}/:version/debug_token`, () =>
        HttpResponse.json({ data: { ...fixtures.debugToken.data, granular_scopes: [] } }),
      ),
      http.get(`${GRAPH}/:version/me/accounts`, () => HttpResponse.json({ data: [] })),
    );
    const tokens = await exchange();
    expect(tokens.accounts).toEqual([]);
    expect(tokens.platformUserId).toBe("");
  });

  it("a missing Pages permission doesn't stop the grants from naming the account", async () => {
    server.use(
      http.get(`${GRAPH}/:version/me/accounts`, () =>
        HttpResponse.json(
          { error: { message: "Missing permission (200)", type: "OAuthException", code: 200 } },
          { status: 403 },
        ),
      ),
    );
    expect((await exchange()).platformUserId).toBe(FIXTURE_IG_USER.id);
  });

  it("keeps the granted permissions, so a refused one is noticed", async () => {
    server.use(
      http.get(`${GRAPH}/:version/debug_token`, () =>
        HttpResponse.json({
          data: {
            ...fixtures.debugToken.data,
            scopes: ["instagram_basic", "instagram_manage_insights", "pages_show_list"],
          },
        }),
      ),
    );
    const tokens = await exchange();
    expect(connectionStatus({ platform: "instagram", grantedScopes: tokens.scopes })).toEqual({
      status: "needs_attention",
      reason: "Publishing permission wasn't granted. Reconnect and allow publishing.",
    });
  });

  it("refuses a token Meta says isn't valid, or one for another app", async () => {
    server.use(
      http.get(`${GRAPH}/:version/debug_token`, () =>
        HttpResponse.json({ data: { ...fixtures.debugToken.data, is_valid: false } }),
      ),
    );
    expect((await rejection(exchange())).code).toBe("unknown");
    server.use(
      http.get(`${GRAPH}/:version/debug_token`, () =>
        HttpResponse.json({ data: { ...fixtures.debugToken.data, app_id: "999" } }),
      ),
    );
    expect((await rejection(exchange())).code).toBe("unknown");
  });

  it("fails with a clear message for a bad code, without leaking the secret", async () => {
    const err = await rejection(
      provider.exchangeCode({ code: "wrong", redirectUri: FIXTURE_REDIRECT_URI }),
    );
    expect(err.code).toBe("unknown");
    expect(err.retryable).toBe(false);
    expect(err.userMessage).toBe("Instagram didn't accept the request. Try connecting again.");
    expect(err.message).not.toContain(FIXTURE_APP.appSecret);
  });

  it("reports a network failure as retryable", async () => {
    server.use(http.get(`${GRAPH}/:version/oauth/access_token`, () => HttpResponse.error()));
    const err = await rejection(exchange());
    expect(err.code).toBe("network");
    expect(err.retryable).toBe(true);
  });
});

describe("instagram: refreshToken", () => {
  it("says the token can't be renewed (Facebook Login user tokens), without calling Meta", async () => {
    const err = await rejection(provider.refreshToken(account));
    expect(err.code).toBe("not_renewable");
    expect(err.retryable).toBe(false);
    expect(err.userMessage).toMatch(/Reconnect/);
  });
});

describe("instagram: getProfile", () => {
  it("reads the Instagram account's id, username, followers and picture", async () => {
    expect(await provider.getProfile(account)).toEqual({
      platformUserId: FIXTURE_IG_USER.id,
      handle: "codingjourney",
      profileUrl: "https://www.instagram.com/codingjourney/",
      followers: 1240,
      accountType: null,
      pictureUrl: FIXTURE_IG_USER.profile_picture_url,
    });
    expect(await provider.getFollowerCount(account)).toBe(1240);
  });

  it("asks GET /{ig-user-id} for the profile fields, with appsecret_proof", async () => {
    let seen: URL | null = null;
    server.use(
      http.get(`${GRAPH}/${IG_GRAPH_VERSION}/${FIXTURE_IG_USER.id}`, ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json(FIXTURE_IG_USER);
      }),
    );
    await provider.getProfile(account);
    const url = seen as URL | null;
    expect(url?.searchParams.get("fields")?.split(",").sort()).toEqual([
      "followers_count",
      "id",
      "profile_picture_url",
      "username",
    ]);
    expect(url?.searchParams.get("appsecret_proof")).toBe(
      appSecretProof(FIXTURE_TOKENS.long, FIXTURE_APP.appSecret),
    );
  });

  it("needs the account's Instagram user id", async () => {
    const err = await rejection(provider.getProfile({ ...account, platformUserId: null }));
    expect(err.code).toBe("token_expired");
  });

  it("maps an expired token (code 190) to token_expired", async () => {
    const err = await rejection(provider.getProfile({ ...account, accessToken: "old" }));
    expect(err.code).toBe("token_expired");
    expect(err.userMessage).toMatch(/Reconnect/);
  });

  it("maps rate limiting (code 4) to a retryable error", async () => {
    server.use(
      http.get(`${GRAPH}/:version/:id`, () =>
        HttpResponse.json(fixtures.errorRateLimited, { status: 400 }),
      ),
    );
    const err = await rejection(provider.getProfile(account));
    expect(err.code).toBe("quota_exhausted");
    expect(err.retryable).toBe(true);
  });

  it("maps a 5xx to a retryable network error", async () => {
    server.use(http.get(`${GRAPH}/:version/:id`, () => HttpResponse.json({}, { status: 503 })));
    const err = await rejection(provider.getProfile(account));
    expect(err.code).toBe("network");
    expect(err.retryable).toBe(true);
  });
});

describe("instagram: publishing", () => {
  const PUBLISH = "https://graph.facebook.com/:version/:user/content_publishing_limit";

  it("reads the publishing quota (usage, total, window)", async () => {
    server.use(
      http.get(PUBLISH, ({ params }) => {
        expect(params.user).toBe(FIXTURE_IG_USER.id);
        return HttpResponse.json(publishFixtures.contentPublishingLimit);
      }),
    );
    expect(await provider.getPublishingQuota(account)).toEqual({
      used: 2,
      limit: 100,
      windowHours: 24,
    });
  });

  it("assumes Instagram's documented limit when config is missing", async () => {
    server.use(http.get(PUBLISH, () => HttpResponse.json({ data: [{ quota_usage: 7 }] })));
    expect(await provider.getPublishingQuota(account)).toEqual({
      used: 7,
      limit: IG_DEFAULT_QUOTA,
      windowHours: 24,
    });
  });

  it("needs the account's Instagram user id", async () => {
    const err = await rejection(provider.getPublishingQuota({ ...account, platformUserId: null }));
    expect(err.code).toBe("token_expired");
    expect(err.userMessage).toMatch(/Reconnect/);
  });

  it("maps every container status_code", async () => {
    const bodies: Record<string, unknown> = {
      a: publishFixtures.containerInProgress,
      b: publishFixtures.containerFinished,
      c: publishFixtures.containerPublished,
    };
    server.use(
      http.get("https://graph.facebook.com/:version/:id", ({ params }) =>
        HttpResponse.json(bodies[String(params.id)] ?? publishFixtures.containerExpired),
      ),
    );
    expect(await provider.getContainerStatus(account, "a")).toEqual({ state: "in_progress" });
    expect(await provider.getContainerStatus(account, "b")).toEqual({ state: "finished" });
    expect(await provider.getContainerStatus(account, "c")).toEqual({ state: "published" });
    const expired = await provider.getContainerStatus(account, "d");
    expect(expired.state).toBe("error");
    if (expired.state === "error") {
      expect(expired.error.retryable).toBe(true);
      expect(expired.error.userMessage).toMatch(/expired/);
    }
  });

  it("maps publishing errors to reasons people can act on", () => {
    expect(graphError(400, publishFixtures.errorMaxPosts).code).toBe("quota_exhausted");
    expect(graphError(400, publishFixtures.errorNotReady).code).toBe("not_ready");
    const aspect = graphError(400, publishFixtures.errorAspectRatio);
    expect(aspect.code).toBe("invalid_media");
    expect(aspect.retryable).toBe(false);
    expect(aspect.userMessage).toMatch(/9:16/);
    expect(graphError(403, publishFixtures.errorNoPermission).code).toBe("token_expired");
    // A missing object is not a video problem.
    expect(
      graphError(400, {
        error: { message: "Unsupported get request", code: 100, error_subcode: 33 },
      }).code,
    ).toBe("unknown");
  });

  it("names a too-long video and an unreadable file", () => {
    expect(mediaProblem(undefined, "The video duration is too long")?.userMessage).toMatch(
      /length/,
    );
    expect(mediaProblem(2207026, "Unsupported")?.userMessage).toMatch(/MP4/);
    expect(mediaProblem(undefined, "Something else")).toBeNull();
  });
});

describe("instagram: getMediaInsights (MSW)", () => {
  beforeEach(() => {
    server.use(...statsHandlers);
  });

  it("maps a Reel's lifetime insights; Instagram's `saved` is saves", async () => {
    expect(await provider.getMediaInsights(account, FULL_MEDIA)).toEqual({
      views: 1520,
      reach: 1184,
      likes: 96,
      comments: 7,
      shares: 12,
      saves: 21,
    });
  });

  it("a metric Instagram leaves out is null, not 0", async () => {
    const insights = await provider.getMediaInsights(account, NO_SHARES_MEDIA);
    expect(insights.shares).toBeNull();
    expect(insights).toMatchObject({ views: 640, reach: 512, likes: 33, comments: 2, saves: 5 });
  });

  it("a rate limit is retryable; an expired token isn't", async () => {
    const limited = await rejection(provider.getMediaInsights(account, RATE_LIMITED_MEDIA));
    expect(limited).toMatchObject({ code: "quota_exhausted", retryable: true });
    const expired = await rejection(
      provider.getMediaInsights({ ...account, accessToken: "stale" }, FULL_MEDIA),
    );
    expect(expired).toMatchObject({ code: "token_expired", retryable: false });
  });

  it("a metric Instagram refuses for the media type (error 100) is null; the others still come", async () => {
    expect(await provider.getMediaInsights(account, SHARES_REFUSED_MEDIA)).toEqual({
      views: 1520,
      reach: 1184,
      likes: 96,
      comments: 7,
      shares: null,
      saves: 21,
    });
  });

  it("a deleted post is not_found, without retrying", async () => {
    expect(await rejection(provider.getMediaInsights(account, "999"))).toMatchObject({
      code: "not_found",
      retryable: false,
    });
  });

  it("parseInsights reads total_value too and ignores junk", () => {
    expect(
      parseInsights([
        { name: "views", total_value: { value: 10 } },
        { name: "likes", values: [{ value: "x" }] },
        null,
      ]),
    ).toEqual({ views: 10, reach: null, likes: null, comments: null, shares: null, saves: null });
  });
});

describe("parseGraphJson", () => {
  it("keeps ids above 2^53 exact and leaves other numbers alone", () => {
    expect(
      parseGraphJson(
        '{"user_id": 17841405822304914, "id":9007199254740993, "expires_in": 5183944}',
      ),
    ).toEqual({ user_id: "17841405822304914", id: "9007199254740993", expires_in: 5183944 });
  });

  it("keeps debug_token's numeric target ids exact", () => {
    expect(
      parseGraphJson('{"granular_scopes":[{"scope":"x","target_ids":[17841400000000001, "2"]}]}'),
    ).toEqual({ granular_scopes: [{ scope: "x", target_ids: ["17841400000000001", "2"] }] });
  });
});

describe("instagramConfigFromEnv", () => {
  it("needs the app id, the secret and the login configuration id", () => {
    expect(instagramConfigFromEnv({})).toBeNull();
    expect(instagramConfigFromEnv({ IG_APP_ID: "1" })).toBeNull();
    expect(instagramConfigFromEnv({ IG_APP_ID: "1", IG_APP_SECRET: "s" })).toBeNull();
    expect(
      instagramConfigFromEnv({ IG_APP_ID: "1", IG_APP_SECRET: "s", IG_LOGIN_CONFIG_ID: " 42 " }),
    ).toEqual({ appId: "1", appSecret: "s", loginConfigId: "42" });
  });
});
