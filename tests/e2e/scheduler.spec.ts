import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// BC-12: the scheduler tick: /dev's "Run tick now" publishes a due post, the tick endpoint
// refuses a wrong secret, and the rail shows the scheduler's status.

interface SandboxDebug {
  counts: Record<string, number>;
  postsByStatus: Record<string, number>;
}

async function sandboxDebug(page: Page): Promise<SandboxDebug> {
  const text = await page.getByTestId("sandbox-debug").textContent();
  return JSON.parse(text ?? "{}") as SandboxDebug;
}

test("publish-due-now: two ticks upload and then publish the due post", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("publish-due-now", { path: "/dev" });
  expect((await sandboxDebug(page)).postsByStatus).toEqual({ queued: 2 });

  const run = page.getByRole("button", { name: "Run tick now" });
  const result = page.getByTestId("tick-result");

  await run.click();
  await expect(result).toHaveAttribute("data-runs", "1");
  await expect(result).toHaveText("Tick done: 1 uploaded.");
  await expect
    .poll(async () => (await sandboxDebug(page)).postsByStatus)
    .toEqual({ publishing: 1, queued: 1 });

  await run.click();
  await expect(result).toHaveAttribute("data-runs", "2");
  await expect(result).toHaveText("Tick done: 1 published.");
  await expect
    .poll(async () => (await sandboxDebug(page)).postsByStatus)
    .toEqual({ published: 1, queued: 1 });

  await run.click();
  await expect(result).toHaveAttribute("data-runs", "3");
  await expect(result).toHaveText("Tick done: nothing was due.");
  expect((await sandboxDebug(page)).counts.job_log).toBe(2);
});

test("the tick endpoint refuses a wrong secret and changes nothing", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("publish-due-now", { path: "/dev" });
  const attempts: Record<string, string>[] = [{ "x-cron-secret": "wrong" }, {}];
  for (const headers of attempts) {
    const res = await page.request.post("/api/cron/tick", { headers });
    expect(res.status()).toBe(401);
  }
  await page.reload();
  const debug = await sandboxDebug(page);
  expect(debug.postsByStatus).toEqual({ queued: 2 });
  expect(debug.counts.job_log).toBe(0);
});

test("the rail shows the scheduler status", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 760, "The rail footer is hidden on phones.");
  await page.goto("/workflow");
  const status = page.getByTestId("scheduler-status");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("data-tone", /^(good|warn)$/);
  await expect(status).toContainText("Scheduler");
});
