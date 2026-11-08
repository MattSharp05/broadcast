import { createHmac } from "node:crypto";
import { http, HttpResponse } from "msw";
import debugToken from "./debug-token.json";
import errorInvalidCode from "./error-invalid-code.json";
import errorRateLimited from "./error-rate-limited.json";
import errorTokenExpired from "./error-token-expired.json";
import igUser from "./ig-user.json";
import longLivedToken from "./long-lived-token.json";
import meAccounts from "./me-accounts.json";
import shortLivedToken from "./short-lived-token.json";

/**
 * MSW handlers for every connection call Broadcast makes: "Instagram API with Facebook Login"
 * through Facebook Login for Business (ADR 0006). Response bodies are the JSON files next to this
 * one, in the shapes Meta documents.
 *
 * The handlers check what a real server would: the app id and secret, the code and redirect, the
 * grant type, the token and its appsecret_proof on each call, so a test catches a request built
 * wrongly.
 */

export const FIXTURE_APP = {
  appId: "1234567890",
  appSecret: "fixture-app-secret",
  loginConfigId: "987654321012345",
};
export const FIXTURE_CODE = "AQ-fixture-code";
export const FIXTURE_REDIRECT_URI = "https://broadcast.test/api/connect/instagram/callback";
export const FIXTURE_TOKENS = {
  short: shortLivedToken.access_token,
  long: longLivedToken.access_token,
};
/** The connected Instagram professional account (GET /{ig-user-id}). */
export const FIXTURE_IG_USER = igUser;
export const fixtures = {
  debugToken,
  errorInvalidCode,
  errorRateLimited,
  errorTokenExpired,
  igUser,
  longLivedToken,
  meAccounts,
  shortLivedToken,
};

export const GRAPH = "https://graph.facebook.com";
const APP_TOKEN = `${FIXTURE_APP.appId}|${FIXTURE_APP.appSecret}`;

/** Tokens the fixture Graph API accepts. */
export const VALID_TOKENS = new Set([FIXTURE_TOKENS.long]);

/**
 * True when the request carries a valid user token with the right appsecret_proof (query string,
 * or the form body for POSTs).
 */
export function validUserToken(request: Request, form?: URLSearchParams): boolean {
  const q = new URL(request.url).searchParams;
  const token = form?.get("access_token") ?? q.get("access_token") ?? "";
  const proof = form?.get("appsecret_proof") ?? q.get("appsecret_proof") ?? "";
  const expected = createHmac("sha256", FIXTURE_APP.appSecret).update(token).digest("hex");
  return VALID_TOKENS.has(token) && proof === expected;
}

export function invalidToken() {
  return HttpResponse.json(errorTokenExpired, { status: 400 });
}

export const instagramHandlers = [
  // Code → short-lived token, and short-lived → long-lived (same endpoint, by grant type).
  http.get(`${GRAPH}/:version/oauth/access_token`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    const app =
      q.get("client_id") === FIXTURE_APP.appId && q.get("client_secret") === FIXTURE_APP.appSecret;
    if (q.get("grant_type") === "fb_exchange_token") {
      return app && q.get("fb_exchange_token") === FIXTURE_TOKENS.short
        ? HttpResponse.json(longLivedToken)
        : invalidToken();
    }
    return app && q.get("redirect_uri") === FIXTURE_REDIRECT_URI && q.get("code") === FIXTURE_CODE
      ? HttpResponse.json(shortLivedToken)
      : HttpResponse.json(errorInvalidCode, { status: 400 });
  }),

  http.get(`${GRAPH}/:version/debug_token`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    if (q.get("access_token") !== APP_TOKEN) return invalidToken();
    if (!VALID_TOKENS.has(q.get("input_token") ?? "")) {
      return HttpResponse.json({
        data: { ...debugToken.data, is_valid: false, scopes: [], granular_scopes: [] },
      });
    }
    return HttpResponse.json(debugToken);
  }),

  http.get(`${GRAPH}/:version/me/accounts`, ({ request }) => {
    if (!validUserToken(request)) return invalidToken();
    return HttpResponse.json(meAccounts);
  }),

  http.get(`${GRAPH}/:version/${igUser.id}`, ({ request }) => {
    if (!validUserToken(request)) return invalidToken();
    return HttpResponse.json(igUser);
  }),
];
