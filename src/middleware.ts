import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideAccess, isPublicPath } from "@/lib/db/access";
import { readPublicSupabaseEnv } from "@/lib/db/env";
import type { Database } from "@/lib/db/types";

/**
 * Refreshes the Supabase session cookies on every request and keeps the dashboard private:
 * signed-out visitors go to /login; a user with any email but ALLOWED_EMAIL is signed out and sees
 * "This dashboard is private." Without Supabase settings nothing is reachable (fails closed).
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const env = readPublicSupabaseEnv();
  const allowedEmail = process.env.ALLOWED_EMAIL;

  // Sign-in pages and the API (its own auth) need no session check: skip the Auth round trip.
  if (isPublicPath(pathname)) return NextResponse.next();
  if (!env) return redirectTo(request, "/login");

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() validates the session with Supabase Auth (getSession() would trust the cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const decision = decideAccess({ pathname, userEmail: user?.email ?? null, allowedEmail });
  if (decision === "allow") return response;

  if (decision === "private") {
    await supabase.auth.signOut();
    return withCookies(redirectTo(request, "/login", { error: "private" }), response);
  }

  const params: Record<string, string> = {};
  if (pathname !== "/") params.next = pathname + request.nextUrl.search;
  return withCookies(redirectTo(request, "/login", params), response);
}

function redirectTo(request: NextRequest, path: string, params: Record<string, string> = {}) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = new URLSearchParams(params).toString();
  return NextResponse.redirect(url);
}

/** Carries refreshed or cleared session cookies over to a redirect response. */
function withCookies(target: NextResponse, source: NextResponse) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

export const config = {
  // Everything except Next's static assets and image files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
