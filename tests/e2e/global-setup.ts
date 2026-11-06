import { request, type FullConfig } from "@playwright/test";

/**
 * Signs in as the owner once (the e2e-only /auth/test-sign-in route, BC-5) and saves the session
 * cookies for every test.
 */
export default async function globalSetup(config: FullConfig) {
  const use = config.projects[0]?.use;
  const baseURL = use?.baseURL;
  const storageState = use?.storageState;
  if (!baseURL || typeof storageState !== "string") {
    throw new Error("playwright.config.ts must set use.baseURL and use.storageState");
  }
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.get("/auth/test-sign-in?next=/dev", { maxRedirects: 0 });
  if (res.status() !== 307) {
    throw new Error(
      `Test sign-in failed (${res.status()}): ${await res.text()}. Is the app running with E2E=1?`,
    );
  }
  await ctx.storageState({ path: storageState });
  await ctx.dispose();
}
