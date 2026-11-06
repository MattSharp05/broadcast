import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// BC-19: connection health. canvas-busy's @tri.weekly lost its access: amber header, paused
// posts, "1 account needs attention" in the rail; Reconnect (fake consent) brings it back.
// token-expiring: a tick renews one token and flags the account whose renewal is refused.

interface SandboxDebug {
  accounts: { handle: string; status: string; posts: Record<string, number> }[];
}

async function sandboxDebug(page: Page): Promise<SandboxDebug> {
  await page.goto("/dev");
  const text = await page.getByTestId("sandbox-debug").textContent();
  return JSON.parse(text ?? "{}") as SandboxDebug;
}

const canvas = (page: Page) => page.getByRole("region", { name: "Workflow canvas" });
const column = (page: Page, handle: string) => page.locator(`[data-column="${handle}"]`);
const header = (page: Page, handle: string) => page.locator(`[data-account="${handle}"]`);
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 760;

test("canvas-busy: @tri.weekly needs attention; Reconnect brings it and its posts back", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("canvas-busy");
  await expect(canvas(page)).toHaveAttribute("data-ready", "true");
  await expect(header(page, "tri.weekly")).toHaveAttribute("data-attention", "");
  await expect(column(page, "tri.weekly").locator('[data-kind="paused"]')).toHaveCount(3);
  if (isDesktop(page)) {
    await expect(page.getByTestId("attention-status")).toHaveText("1 account needs attention");
  }

  await header(page, "tri.weekly").focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByTestId("drawer-account");
  await expect(drawer.getByTestId("reconnect")).toContainText("Instagram access expired");

  const popupOpened = page.waitForEvent("popup");
  await drawer.getByRole("button", { name: "Reconnect Instagram" }).click();
  const popup = await popupOpened;
  // The fake consent screen signs in as the account being reconnected.
  await expect(popup.getByLabel("Instagram user")).toHaveValue("tri.weekly");
  await popup.getByRole("button", { name: "Allow" }).click();
  await popup.waitForEvent("close");

  await expect(page.getByTestId("toast")).toHaveText(
    "@tri.weekly reconnected. Its paused posts are back in the queue.",
  );
  await expect(drawer.getByTestId("reconnect")).toHaveCount(0);
  await expect(drawer).toContainText("Ready");
  await page.keyboard.press("Escape");
  await expect(header(page, "tri.weekly")).not.toHaveAttribute("data-attention", "");
  await expect(column(page, "tri.weekly").locator('[data-kind="paused"]')).toHaveCount(0);
  if (isDesktop(page)) await expect(page.getByTestId("attention-status")).toHaveCount(0);

  const tri = (await sandboxDebug(page)).accounts.find((a) => a.handle === "tri.weekly");
  expect(tri?.status).toBe("ready");
  expect(tri?.posts.paused ?? 0).toBe(0);
  expect(tri?.posts.queued).toBe(3);
});

test("the rail's attention line opens Accounts filtered to them", async ({
  page,
  loadScenario,
}) => {
  test.skip(!isDesktop(page), "The rail's footer is hidden on a phone.");
  await loadScenario("canvas-busy");
  await page.getByTestId("attention-status").click();
  await expect(page).toHaveURL(/\/accounts\?status=needs_attention$/);
  await expect(page.locator("tr[data-account]")).toHaveCount(1);
  await expect(page.locator('tr[data-account="tri.weekly"]')).toBeVisible();
});

test("token-expiring: a tick renews one token and flags the account whose renewal is refused", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("token-expiring", { path: "/dev" });
  await page.getByRole("button", { name: "Run tick now" }).click();
  await expect(page.getByTestId("tick-result")).toHaveText(
    "Tick done: 1 token renewed, 1 account needs attention.",
  );
  const debug = await sandboxDebug(page);
  expect(debug.accounts.find((a) => a.handle === "codingjourney")).toMatchObject({
    status: "ready",
    posts: { queued: 3 },
  });
  expect(debug.accounts.find((a) => a.handle === "tri.weekly")).toMatchObject({
    status: "needs_attention",
    posts: { paused: 3 },
  });

  await page.goto("/accounts");
  await page.getByRole("button", { name: "Details for @codingjourney" }).click();
  await expect(page.getByTestId("drawer-account")).toContainText(
    "Renews automatically, 60 days left",
  );
});
