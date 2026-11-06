import type { Page } from "@playwright/test";
import { E2E_NOW, expect, test } from "./fixtures";

// BC-8: the harness itself: sign-in, scenarios, the Sandbox workspace and /dev.

interface SandboxDebug {
  workspace: string;
  clock: "fixed" | "real";
  now: string;
  counts: Record<string, number>;
  postsByStatus: Record<string, number>;
  accounts: { handle: string; brand: string; status: string; posts: Record<string, number> }[];
}

async function sandboxDebug(page: Page): Promise<SandboxDebug> {
  await page.goto("/dev");
  const text = await page.getByTestId("sandbox-debug").textContent();
  return JSON.parse(text ?? "{}") as SandboxDebug;
}

const marker = (page: Page) => page.getByTestId("sandbox-marker");
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 760;

test("signed in, the dashboard loads with the rail", async ({ page }) => {
  await page.goto("/workflow");
  await expect(page.getByRole("heading", { name: "Workflow" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("/workflow?scenario=canvas-busy switches to the Sandbox and seeds it", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("canvas-busy");
  await expect(page).toHaveURL(/\/workflow$/);
  await expect(marker(page)).toContainText("Sandbox: example data");
  if (isDesktop(page)) {
    await expect(page.getByRole("button", { name: "Sandbox" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }

  const debug = await sandboxDebug(page);
  expect(debug.workspace).toBe("Sandbox");
  expect(debug.clock).toBe("fixed");
  expect(debug.now).toBe(new Date(E2E_NOW).toISOString());
  expect(debug.counts.brands).toBe(5);
  expect(debug.counts.social_accounts).toBe(5);
  expect(debug.postsByStatus.failed).toBe(1);
  expect(debug.accounts.map((a) => a.handle)).toContain("codingjourney");
  expect(debug.accounts.find((a) => a.handle === "tri.weekly")?.status).toBe("needs_attention");
});

test("/dev lists every scenario and each link loads it", async ({ page }) => {
  await page.goto("/dev");
  const links = page.getByRole("region", { name: "Scenarios" }).getByRole("link");
  await expect(links).toHaveText([
    "canvas-busy",
    "empty",
    "connect-missing-permission",
    "publish-due-now",
    "no-accounts",
    "publish-quota-exhausted",
    "publish-container-error",
    "stats-due",
  ]);
  await expect(page.getByRole("link", { name: "Canvas engine demo" })).toHaveAttribute(
    "href",
    "/dev/canvas",
  );

  const expected: Record<string, number> = {
    "canvas-busy": 5,
    empty: 1,
    "connect-missing-permission": 1,
    "publish-due-now": 1,
    "no-accounts": 0,
    "publish-quota-exhausted": 1,
    "publish-container-error": 1,
    "stats-due": 1,
  };
  for (const [name, accounts] of Object.entries(expected)) {
    await page.goto("/dev");
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(/\/workflow$/);
    await expect(marker(page)).toBeVisible();
    const debug = await sandboxDebug(page);
    expect(debug.counts.social_accounts, name).toBe(accounts);
    expect(debug.clock, name).toBe("real");
  }
});

test("?now= alone sets the Sandbox clock", async ({ page, loadScenario }) => {
  await loadScenario("empty", { now: null });
  await page.goto("/accounts?now=2026-12-24T18:00:00Z");
  await expect(page).toHaveURL(/\/accounts$/);
  const debug = await sandboxDebug(page);
  expect(debug.clock).toBe("fixed");
  expect(debug.now).toBe("2026-12-24T18:00:00.000Z");
  expect(debug.counts.social_accounts).toBe(1);
});

test("the workspace switcher goes back to Live", async ({ page, loadScenario }) => {
  await loadScenario("empty");
  await marker(page).getByRole("button", { name: "Switch to Live" }).click();
  await expect(marker(page)).toHaveCount(0);
  if (isDesktop(page)) {
    await expect(page.getByRole("button", { name: "Live" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Sandbox" }).click();
    await expect(marker(page)).toBeVisible();
  }
});

test("an unknown scenario is a 404 listing the real ones", async ({ page }) => {
  const res = await page.request.get("/api/dev/scenario/nope");
  expect(res.status()).toBe(404);
  expect(((await res.json()) as { scenarios: string[] }).scenarios).toContain("canvas-busy");
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("pages redirect to sign-in, keeping the scenario for afterwards", async ({ page }) => {
    await page.goto("/workflow?scenario=empty");
    await expect(page).toHaveURL(/\/login\?next=%2Fworkflow%3Fscenario%3Dempty$/);
  });

  test("/dev needs sign-in", async ({ page }) => {
    await page.goto("/dev");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the scenario API refuses to load anything", async ({ page }) => {
    const res = await page.request.get("/api/dev/scenario/empty");
    expect(res.status()).toBe(401);
  });
});
