import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
import {
  IG_GRAPH_VERSION,
  createInstagramProvider,
  instagramConfigFromEnv,
  parseGraphJson,
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

describe("instagram: not built yet", () => {
  it("publishing and stats fail as unsupported until BC-16/BC-17", async () => {
    expect((await rejection(provider.getPublishingQuota(account))).code).toBe("unsupported");
    expect(
      (await rejection(provider.createReelContainer(account, { videoUrl: "x", caption: "" }))).code,
    ).toBe("unsupported");
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
