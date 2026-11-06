import type { Page } from "@playwright/test";
import { compactCount } from "../../src/lib/domain/format";
import { stableUuid } from "../../src/lib/hash";
import { fakeInsights } from "../../src/lib/providers/fake";
import { STATS_DUE_FOLLOWERS, statsDueMediaId } from "../../src/lib/scenarios/stats-due";
import { expect, test } from "./fixtures";

// BC-21: stats collection by the scheduler, on the Sandbox (fake provider): "Run tick now" fills
// the 1 h snapshot and the posted card's numbers update; a post that fell behind gets its 48 h
// snapshot with 6 h and 24 h shown as missed in the drawer chart.

const card = (page: Page, key: string) =>
  page.locator(`[data-post="${stableUuid("stats-due", "post", key)}"]`);

async function openCanvas(page: Page) {
  await page.goto("/workflow");
  await expect(page.getByRole("region", { name: "Workflow canvas" })).toHaveAttribute(
    "data-ready",
    "true",
  );
}

test("stats-due: Run tick now fills the 1 h snapshot and the card's views update", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("stats-due");
  const fresh = card(page, "fresh");
  await expect(fresh).toHaveAttribute("data-kind", "posted");
  await expect(fresh.getByTitle("Views")).toHaveText("0");

  await page.goto("/dev");
  await page.getByRole("button", { name: "Run tick now" }).click();
  const result = page.getByTestId("tick-result");
  await expect(result).toHaveAttribute("data-runs", "1");
  await expect(result).toHaveText("Tick done: stats refreshed for 2 posts.");

  // The fake provider's curve, 65 minutes after posting (the Sandbox clock is frozen).
  const expected = fakeInsights(statsDueMediaId("fresh"), STATS_DUE_FOLLOWERS, 65 / 60);
  await openCanvas(page);
  await expect(fresh.getByTitle("Views")).toHaveText(compactCount(expected.views));
  await expect(fresh.getByTitle("Likes")).toHaveText(compactCount(expected.likes));

  // Nothing else is due now (a fresh /dev page counts runs from 0 again).
  await page.goto("/dev");
  await page.getByRole("button", { name: "Run tick now" }).click();
  await expect(result).toHaveAttribute("data-runs", "1");
  await expect(result).toHaveText("Tick done: nothing was due.");
});

test("stats-due: after catching up, the drawer shows 48 h taken and 6 h, 24 h missed", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("stats-due", { path: "/dev" });
  await page.getByRole("button", { name: "Run tick now" }).click();
  await expect(page.getByTestId("tick-result")).toHaveAttribute("data-runs", "1");

  await openCanvas(page);
  const behind = card(page, "behind");
  await behind.focus();
  await page.keyboard.press("Enter");
  const chart = page.getByRole("dialog").locator('[data-chart="refreshes"]');
  await expect(chart).toBeVisible();
  await expect(chart.locator("[data-bar]")).toHaveCount(5);
  await expect(chart.locator('[data-bar="missed"]')).toHaveCount(2);
  await expect(chart.locator('[data-bar="latest"]')).toHaveCount(1);
  await expect(chart).toHaveAttribute("aria-label", /6 h: missed, 24 h: missed/);
  await expect(page.getByRole("dialog")).toContainText("7 days after posting");
});
