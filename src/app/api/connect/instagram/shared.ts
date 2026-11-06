import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { configuredAppOrigin } from "@/lib/app-url";
import type { ConnectErrorCode } from "@/lib/domain/connect";
import type { ProviderPlatform } from "@/lib/providers/types";

/**
 * Shared by the connect start and callback routes. The state lives in two places: an
 * `oauth_states` row (one use, 10 minutes) and an httpOnly cookie in the browser that started the
 * attempt. The callback needs both to match, so a callback link from somewhere else (login CSRF:
 * someone else's code) is refused.
 */

export const STATE_COOKIE = "bc-oauth-state";
const COOKIE_PATH = "/api/connect";
export const CALLBACK_PATH = "/api/connect/instagram/callback";

/**
 * The site a connect attempt runs on. Instagram's redirect URI must match the Meta app's setting
 * exactly, so Instagram uses the configured origin (APP_URL); the Sandbox's fake consent screen
 * stays on the current site. The start route moves to this origin first, so the state cookie is
 * set on the same host the callback comes back to.
 */
export function connectOrigin(request: NextRequest, platform: ProviderPlatform): string {
  const configured = platform === "instagram" ? configuredAppOrigin() : null;
  return configured ?? request.nextUrl.origin;
}

export function redirectUriFor(request: NextRequest, platform: ProviderPlatform): string {
  return new URL(CALLBACK_PATH, connectOrigin(request, platform)).toString();
}

/**
 * True for a request another website started (Sec-Fetch-Site: cross-site). Starting a connect
 * replaces the state cookie, so other sites mustn't be able to trigger it and break an attempt in
 * progress. Browsers without the header (old ones, or tools) are let through.
 */
export function isCrossSite(request: NextRequest): boolean {
  return request.headers.get("sec-fetch-site") === "cross-site";
}

/**
 * A 303 to the done page, with the attempt's state cookie cleared, except when the callback's
 * state didn't match it (`keepCookie`): a forged callback link mustn't cancel a real attempt.
 */
export function toDonePage(
  request: NextRequest,
  outcome: { account: string } | { error: ConnectErrorCode },
  { keepCookie = false } = {},
): NextResponse {
  const url = new URL("/connect/done", request.url);
  if ("account" in outcome) url.searchParams.set("account", outcome.account);
  else url.searchParams.set("error", outcome.error);
  const res = NextResponse.redirect(url, 303);
  if (!keepCookie) res.cookies.set(STATE_COOKIE, "", { path: COOKIE_PATH, maxAge: 0 });
  return res;
}

export function setStateCookie(res: NextResponse, request: NextRequest, state: string): void {
  res.cookies.set(STATE_COOKIE, state, {
    path: COOKIE_PATH,
    httpOnly: true,
    // Lax: the cookie must come back on the top-level redirect from instagram.com.
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 10 * 60,
  });
}

/** Constant-time comparison of two state strings. */
export function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

/** Signed-out requests go to sign-in, then to Accounts. */
export function toSignIn(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/login?next=/accounts", request.url), 303);
}
