import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectionStatus, requiredScopes } from "@/lib/domain/connect";
import {
  FIXTURE_APP,
  FIXTURE_CODE,
  FIXTURE_ME,
  FIXTURE_REDIRECT_URI,
  FIXTURE_TOKENS,
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
  platformUserId: FIXTURE_ME.user_id,
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
  it("asks Instagram Login for the three business scopes, with the state and redirect", () => {
    const url = new URL(
      provider.authorizeUrl({ state: "state-123", redirectUri: FIXTURE_REDIRECT_URI }),
    );
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(FIXTURE_APP.appId);
    expect(url.searchParams.get("redirect_uri")).toBe(FIXTURE_REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("scope")?.split(",")).toEqual([
      "instagram_business_content_publish",
      "instagram_business_basic",
      "instagram_business_manage_insights",
    ]);
    // The app secret never goes to the browser.
    expect(url.toString()).not.toContain(FIXTURE_APP.appSecret);
  });
});

describe("instagram: exchangeCode", () => {
  it("swaps the code for a short-lived token, then a 60-day long-lived one", async () => {
    const tokens = await provider.exchangeCode({
      code: `${FIXTURE_CODE}#_`,
      redirectUri: FIXTURE_REDIRECT_URI,
    });
    expect(tokens.accessToken).toBe(FIXTURE_TOKENS.long);
    expect(tokens.platformUserId).toBe(FIXTURE_ME.user_id);
    expect(tokens.scopes).toEqual(requiredScopes("instagram").slice().sort());
    expect(tokens.expiresAt.getTime() - NOW.getTime()).toBe(
      fixtures.longLivedToken.expires_in * 1000,
    );
  });

  it("accepts the older flat response with a permissions array", async () => {
    server.use(
      http.post("https://api.instagram.com/oauth/access_token", () =>
        // Raw text: user_id is a bare number above 2^53, as Instagram sends it.
        HttpResponse.text(
          `{"access_token":"${FIXTURE_TOKENS.short}","user_id":17841400000000001,"permissions":["instagram_business_basic"]}`,
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const tokens = await provider.exchangeCode({
      code: FIXTURE_CODE,
      redirectUri: FIXTURE_REDIRECT_URI,
    });
    expect(tokens.platformUserId).toBe("17841400000000001");
    expect(tokens.scopes).toEqual(["instagram_business_basic"]);
  });

  it("keeps the granted permissions, so a refused one is noticed", async () => {
    server.use(
      http.post("https://api.instagram.com/oauth/access_token", () =>
        HttpResponse.json({
          data: [
            {
              access_token: FIXTURE_TOKENS.short,
              user_id: FIXTURE_ME.user_id,
              permissions: "instagram_business_basic,instagram_business_manage_insights",
            },
          ],
        }),
      ),
    );
    const tokens = await provider.exchangeCode({
      code: FIXTURE_CODE,
      redirectUri: FIXTURE_REDIRECT_URI,
    });
    expect(connectionStatus({ platform: "instagram", grantedScopes: tokens.scopes })).toEqual({
      status: "needs_attention",
      reason: "Publishing permission wasn't granted. Reconnect and allow publishing.",
    });
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
    server.use(
      http.post("https://api.instagram.com/oauth/access_token", () => HttpResponse.error()),
    );
    const err = await rejection(
      provider.exchangeCode({ code: FIXTURE_CODE, redirectUri: FIXTURE_REDIRECT_URI }),
    );
    expect(err.code).toBe("network");
    expect(err.retryable).toBe(true);
  });

  it("assumes the requested scopes when the response has no permissions field", async () => {
    server.use(
      http.post("https://api.instagram.com/oauth/access_token", () =>
        HttpResponse.json({ data: [{ access_token: FIXTURE_TOKENS.short, user_id: "1" }] }),
      ),
    );
    const tokens = await provider.exchangeCode({
      code: FIXTURE_CODE,
      redirectUri: FIXTURE_REDIRECT_URI,
    });
    expect(tokens.scopes).toEqual(requiredScopes("instagram"));
  });
});

describe("instagram: refreshToken", () => {
  it("returns the refreshed token with a new expiry", async () => {
    const tokens = await provider.refreshToken(account);
    expect(tokens.accessToken).toBe(FIXTURE_TOKENS.refreshed);
    expect(tokens.platformUserId).toBe(FIXTURE_ME.user_id);
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("maps an expired token (code 190) to token_expired", async () => {
    const err = await rejection(provider.refreshToken({ ...account, accessToken: "old" }));
    expect(err.code).toBe("token_expired");
    expect(err.userMessage).toMatch(/Reconnect/);
  });
});

describe("instagram: getProfile", () => {
  it("reads id, username, account type, followers and picture", async () => {
    expect(await provider.getProfile(account)).toEqual({
      platformUserId: FIXTURE_ME.user_id,
      handle: "codingjourney",
      profileUrl: "https://www.instagram.com/codingjourney/",
      followers: 1240,
      accountType: "MEDIA_CREATOR",
      pictureUrl: FIXTURE_ME.profile_picture_url,
    });
    expect(await provider.getFollowerCount(account)).toBe(1240);
  });

  it("asks for the profile fields on the versioned /me endpoint", async () => {
    let seen: URL | null = null;
    server.use(
      http.get(`https://graph.instagram.com/${IG_GRAPH_VERSION}/me`, ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json(FIXTURE_ME);
      }),
    );
    await provider.getProfile(account);
    const url = seen as URL | null;
    expect(url?.searchParams.get("fields")?.split(",").sort()).toEqual([
      "account_type",
      "followers_count",
      "profile_picture_url",
      "user_id",
      "username",
    ]);
  });

  it("maps rate limiting (code 4) to a retryable error", async () => {
    server.use(
      http.get("https://graph.instagram.com/:version/me", () =>
        HttpResponse.json(fixtures.errorRateLimited, { status: 400 }),
      ),
    );
    const err = await rejection(provider.getProfile(account));
    expect(err.code).toBe("quota_exhausted");
    expect(err.retryable).toBe(true);
  });

  it("maps a 5xx to a retryable network error", async () => {
    server.use(
      http.get("https://graph.instagram.com/:version/me", () =>
        HttpResponse.json({}, { status: 503 }),
      ),
    );
    const err = await rejection(provider.getProfile(account));
    expect(err.code).toBe("network");
    expect(err.retryable).toBe(true);
  });
});

describe("instagram: publishing", () => {
  const PUBLISH = "https://graph.instagram.com/:version/:user/content_publishing_limit";

  it("reads the publishing quota (usage, total, window)", async () => {
    server.use(
      http.get(PUBLISH, ({ params }) => {
        expect(params.user).toBe(FIXTURE_ME.user_id);
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
      http.get("https://graph.instagram.com/:version/:id", ({ params }) =>
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
});

describe("instagramConfigFromEnv", () => {
  it("needs both the app id and secret", () => {
    expect(instagramConfigFromEnv({})).toBeNull();
    expect(instagramConfigFromEnv({ IG_APP_ID: "1" })).toBeNull();
    expect(instagramConfigFromEnv({ IG_APP_ID: "1", IG_APP_SECRET: "s" })).toEqual({
      appId: "1",
      appSecret: "s",
    });
  });
});
