/**
 * Who may see what. Pure functions, shared by the middleware, the sign-in action and tests.
 * The database enforces the same rule with RLS (`public.is_allowed_user()`).
 */

/** Trimmed, lower-cased email, or "" for nothing. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** True only when both are set and equal (case-insensitive). An unset ALLOWED_EMAIL allows nobody. */
export function isAllowedEmail(
  email: string | null | undefined,
  allowed: string | null | undefined,
): boolean {
  const a = normalizeEmail(allowed);
  return a !== "" && normalizeEmail(email) === a;
}

/** Routes that work signed out: sign-in pages, auth callbacks and the API (which has its own auth). */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/auth/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/")
  );
}

export type AccessDecision = "allow" | "login" | "private";

/**
 * What the middleware does with a request: let it through, send a signed-out visitor to /login,
 * or sign out a user with another email and show "This dashboard is private."
 */
export function decideAccess(input: {
  pathname: string;
  userEmail: string | null;
  allowedEmail: string | null | undefined;
}): AccessDecision {
  if (isPublicPath(input.pathname)) return "allow";
  if (input.userEmail === null) return "login";
  return isAllowedEmail(input.userEmail, input.allowedEmail) ? "allow" : "private";
}

/** Only same-site paths are allowed as a post-sign-in destination (no open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/workflow"): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
