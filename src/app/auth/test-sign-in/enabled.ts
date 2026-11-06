/** The e2e sign-in helper exists only with E2E=1, and never on Vercel production. */
export function testSignInEnabled(env: Record<string, string | undefined>): boolean {
  return env.E2E === "1" && env.VERCEL_ENV !== "production";
}
