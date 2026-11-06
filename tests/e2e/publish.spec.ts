import type { Page } from "@playwright/test";
import { stableUuid } from "../../src/lib/hash";
import { expect, test } from "./fixtures";

// BC-16: publishing through the scheduler, on the Sandbox (fake provider): a due post ends up
// posted on the canvas; a full quota makes it wait; a rejected video fails with the reason.

const dueCard = (page: Page, scenario: string) =>
  page.locator(`[data-post="${stableUuid(scenario, "post", "due")}"]`);

interface SandboxDebug {
  counts: Record<string, number>;
  postsByStatus: Record<string, number>;
}

async function sandboxDebug(page: Page): Promise<SandboxDebug> {
  const text = await page.getByTestId("sandbox-debug").textContent();
  return JSON.parse(text ?? "{}") as SandboxDebug;
}

async function runTick(page: Page, runs: number, expected: string) {
  await page.getByRole("button", { name: "Run tick now" }).click();
  const result = page.getByTestId("tick-result");
  await expect(result).toHaveAttribute("data-runs", String(runs));
  await expect(result).toHaveText(expected);
}

async function openCanvas(page: Page) {
  await page.goto("/workflow");
  await expect(page.getByRole("region", { name: "Workflow canvas" })).toHaveAttribute(
    "data-ready",
    "true",
  );
}

test("publish-due-now: after Run tick now, the due post moves to Posted on the canvas", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("publish-due-now");
  await expect(dueCard(page, "publish-due-now")).toHaveAttribute("data-kind", "scheduled");

  await page.goto("/dev");
  await runTick(page, 1, "Tick done: 1 uploaded.");
  await runTick(page, 2, "Tick done: 1 published.");

  await openCanvas(page);
  await expect(dueCard(page, "publish-due-now")).toHaveAttribute("data-kind", "posted");
});

test("publish-quota-exhausted: nothing is uploaded; the post waits", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("publish-quota-exhausted", { path: "/dev" });
  await runTick(page, 1, "Tick done: 1 waiting for quota.");
  await page.reload();
  const debug = await sandboxDebug(page);
  expect(debug.postsByStatus).toEqual({ queued: 2 });

  // Waiting until the next slot: another tick does nothing.
  await runTick(page, 1, "Tick done: nothing was due.");

  await openCanvas(page);
  await expect(dueCard(page, "publish-quota-exhausted")).not.toHaveAttribute(
    "data-kind",
    /posted|failed/,
  );
});

test("publish-container-error: the upload fails with the reason on the canvas", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("publish-container-error", { path: "/dev" });
  await runTick(page, 1, "Tick done: 1 uploaded.");
  await runTick(page, 2, "Tick done: 1 failed.");

  await openCanvas(page);
  const card = dueCard(page, "publish-container-error");
  await expect(card).toHaveAttribute("data-kind", "failed");
  await expect(card).toContainText("Failed");
});
