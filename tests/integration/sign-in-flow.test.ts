import { afterAll, describe, expect, it } from "vitest";
import { deleteUser, setAllowedEmail } from "./helpers";

/**
 * The dashboard's sign-in gate, over HTTP against a running app (`pnpm build && pnpm start` with
 * E2E=1 and ALLOWED_EMAIL set). Skipped unless APP_TEST_URL points at it; CI sets it. The
 * Playwright version of this check arrives with the e2e harness (BC-8).
 */
const appUrl = process.env.APP_TEST_URL;
const allowedEmail = process.env.ALLOWED_EMAIL;

function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c?.endsWith("="))
    .join("; ");
}

describe.skipIf(!appUrl || !allowedEmail)("sign-in gate (running app)", () => {
  const base = appUrl ?? "";

  afterAll(async () => {
    if (allowedEmail) await deleteUser(allowedEmail);
    await setAllowedEmail(null);
  });

  it("signed out: /workflow redirects to /login", async () => {
    const res = await fetch(`${base}/workflow`, { redirect: "manual" });
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "", base);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/workflow");
  });

  it("the login page renders", async () => {
    const res = await fetch(`${base}/login`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Send sign-in link");
  });

  it("after the test sign-in, /workflow loads; after sign-out it redirects again", async () => {
    const signIn = await fetch(`${base}/auth/test-sign-in?next=/workflow`, { redirect: "manual" });
    expect(signIn.status).toBe(307);
    expect(new URL(signIn.headers.get("location") ?? "", base).pathname).toBe("/workflow");
    const cookies = cookieHeader(signIn);
    expect(cookies).toMatch(/sb-.*-auth-token/);

    const page = await fetch(`${base}/workflow`, {
      headers: { cookie: cookies },
      redirect: "manual",
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Sign out");

    const signOut = await fetch(`${base}/auth/sign-out`, {
      method: "POST",
      headers: { cookie: cookies },
      redirect: "manual",
    });
    expect(signOut.status).toBe(303);
    // The session is revoked server-side, so the old cookies no longer get in.
    const after = await fetch(`${base}/workflow`, {
      headers: { cookie: cookies },
      redirect: "manual",
    });
    expect(after.status).toBe(307);
  });
});
