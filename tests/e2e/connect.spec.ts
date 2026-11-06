import type { Page } from "@playwright/test";
import { stableUuid } from "../../src/lib/hash";
import { expect, test } from "./fixtures";

// BC-9: connecting an account. The Sandbox runs the whole flow with the fake provider (start →
// fake consent → callback → done); Live has no Instagram app in e2e, so it must fail clearly.

const EMPTY_BRAND = stableUuid("empty", "brand");
const MISSING_BRAND = stableUuid("connect-missing-permission", "brand");

interface SandboxDebug {
  counts: Record<string, number>;
  accounts: { handle: string; status: string }[];
}

async function sandboxDebug(page: Page): Promise<SandboxDebug> {
  await page.goto("/dev");
  const text = await page.getByTestId("sandbox-debug").textContent();
  return JSON.parse(text ?? "{}") as SandboxDebug;
}

async function startConnect(page: Page, brandId: string) {
  await page.goto(`/api/connect/instagram/start?brand=${brandId}`);
  await expect(page).toHaveURL(/\/connect\/fake\?state=/);
  await expect(
    page.getByRole("heading", { name: "Allow Broadcast to use this account?" }),
  ).toBeVisible();
}

const done = (page: Page) => page.getByTestId("connect-done");

test("Sandbox: start → fake consent → callback creates a ready account", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("empty");
  await startConnect(page, EMPTY_BRAND);
  await page.getByLabel("Instagram user").fill("e2e.creator");
  await page.getByRole("button", { name: "Allow" }).click();

  await expect(page).toHaveURL(/\/connect\/done\?account=/);
  await expect(done(page).getByRole("heading")).toHaveText("Connected @e2e.creator");
  await expect(done(page)).toContainText("Ready");
  await expect(done(page)).toContainText("followers");
  // Opened directly (no wizard popup): back to Accounts.
  await page.waitForURL(/\/accounts$/);

  const debug = await sandboxDebug(page);
  expect(debug.counts.social_accounts).toBe(2);
  expect(debug.accounts.find((a) => a.handle === "e2e.creator")?.status).toBe("ready");
});

test("Sandbox: a refused publishing permission leaves the account needing attention", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("empty");
  await startConnect(page, EMPTY_BRAND);
  await page.getByLabel("Publish Reels").uncheck();
  await page.getByRole("button", { name: "Allow" }).click();

  await expect(done(page).getByRole("heading")).toHaveText("Connected @sandbox.creator");
  await expect(done(page)).toContainText("Needs attention");
  await expect(done(page).getByRole("alert")).toHaveText(
    "Publishing permission wasn't granted. Reconnect and allow publishing.",
  );
  // Stays on screen so the reason can be read.
  await page.waitForTimeout(3000);
  await expect(page).toHaveURL(/\/connect\/done/);
});

test("Sandbox: reconnecting the same user fixes the account instead of adding one", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("connect-missing-permission");
  let debug = await sandboxDebug(page);
  expect(debug.accounts).toEqual([
    expect.objectContaining({ handle: "missing.permission", status: "needs_attention" }),
  ]);

  await startConnect(page, MISSING_BRAND);
  await page.getByLabel("Instagram user").fill("missing.permission");
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(done(page)).toContainText("Ready");

  debug = await sandboxDebug(page);
  expect(debug.counts.social_accounts).toBe(1);
  expect(debug.accounts[0]?.status).toBe("ready");
});

test("Sandbox: Cancel on the consent screen connects nothing", async ({ page, loadScenario }) => {
  await loadScenario("empty");
  await startConnect(page, EMPTY_BRAND);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(done(page).getByRole("heading")).toHaveText("Couldn’t connect the account");
  await expect(done(page)).toContainText("Access wasn't allowed");
  expect((await sandboxDebug(page)).counts.social_accounts).toBe(1);
});

test("a callback with a forged or reused state is refused", async ({ page, loadScenario }) => {
  await loadScenario("empty");
  await startConnect(page, EMPTY_BRAND);
  const consentUrl = new URL(page.url());
  const state = consentUrl.searchParams.get("state") ?? "";

  // Someone else's state (no matching cookie in this browser).
  await page.goto(`/api/connect/instagram/callback?state=forged&code=fake_code.x`);
  await expect(done(page)).toContainText("This connection link isn't valid any more");

  // The real state, used once, then replayed.
  await page.goto(consentUrl.pathname + consentUrl.search);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(done(page)).toContainText("Ready");
  await page.goto(`/api/connect/instagram/callback?state=${state}&code=fake_code.x`);
  await expect(done(page)).toContainText("This connection link isn't valid any more");
  expect((await sandboxDebug(page)).counts.social_accounts).toBe(2);
});

test("Live without an Instagram app: a clear message, nothing connected", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "bc-workspace", value: "live", url: baseURL ?? "" }]);
  await page.goto(`/api/connect/instagram/start?brand=${EMPTY_BRAND}`);
  await expect(done(page).getByRole("heading")).toHaveText("Couldn’t connect the account");
  await expect(done(page)).toContainText("IG_APP_ID and IG_APP_SECRET are missing");
});
