import { http, HttpResponse } from "msw";
import errorInvalidCode from "./error-invalid-code.json";
import errorRateLimited from "./error-rate-limited.json";
import errorTokenExpired from "./error-token-expired.json";
import longLivedToken from "./long-lived-token.json";
import me from "./me.json";
import refreshedToken from "./refreshed-token.json";
import shortLivedToken from "./short-lived-token.json";

/**
 * MSW handlers for every Instagram call Broadcast makes (Instagram API with Instagram Login).
 * Response bodies are the JSON files next to this one, in the shapes Instagram documents.
 *
 * The handlers check what a real server would: the app secret, the code, the grant type and the
 * token on each call, so a test catches a request built wrongly.
 */

export const FIXTURE_APP = { appId: "1234567890", appSecret: "fixture-app-secret" };
export const FIXTURE_CODE = "AQ-fixture-code";
export const FIXTURE_REDIRECT_URI = "https://broadcast.test/api/connect/instagram/callback";
export const FIXTURE_TOKENS = {
  short: shortLivedToken.data[0]?.access_token ?? "",
  long: longLivedToken.access_token,
  refreshed: refreshedToken.access_token,
};
export const FIXTURE_ME = me;
export const fixtures = {
  errorInvalidCode,
  errorRateLimited,
  errorTokenExpired,
  longLivedToken,
  me,
  refreshedToken,
  shortLivedToken,
};

const TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const GRAPH = "https://graph.instagram.com";

/** Tokens the fixture Graph API accepts. */
const VALID_TOKENS = new Set([FIXTURE_TOKENS.long, FIXTURE_TOKENS.refreshed]);

export const instagramHandlers = [
  http.post(TOKEN_URL, async ({ request }) => {
    const form = new URLSearchParams(await request.text());
    const ok =
      form.get("client_id") === FIXTURE_APP.appId &&
      form.get("client_secret") === FIXTURE_APP.appSecret &&
      form.get("grant_type") === "authorization_code" &&
      form.get("redirect_uri") === FIXTURE_REDIRECT_URI &&
      form.get("code") === FIXTURE_CODE;
    return ok
      ? HttpResponse.json(shortLivedToken)
      : HttpResponse.json(errorInvalidCode, { status: 400 });
  }),

  http.get(`${GRAPH}/access_token`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    const ok =
      q.get("grant_type") === "ig_exchange_token" &&
      q.get("client_secret") === FIXTURE_APP.appSecret &&
      q.get("access_token") === FIXTURE_TOKENS.short;
    return ok
      ? HttpResponse.json(longLivedToken)
      : HttpResponse.json(errorTokenExpired, { status: 400 });
  }),

  http.get(`${GRAPH}/refresh_access_token`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    const ok =
      q.get("grant_type") === "ig_refresh_token" && VALID_TOKENS.has(q.get("access_token") ?? "");
    return ok
      ? HttpResponse.json(refreshedToken)
      : HttpResponse.json(errorTokenExpired, { status: 400 });
  }),

  http.get(`${GRAPH}/:version/me`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    if (!VALID_TOKENS.has(q.get("access_token") ?? "")) {
      return HttpResponse.json(errorTokenExpired, { status: 400 });
    }
    return HttpResponse.json(me);
  }),
];
