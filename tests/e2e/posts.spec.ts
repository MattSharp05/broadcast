import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The Posts tab: every post with its video's recipe, routine, tags and stats; filters and sort
// kept in the URL; a summary row for the filtered posts; bulk tags (scenario posts-table).

const rows = (page: Page) => page.getByTestId("post-row");
const titles = (page: Page) => rows(page).getByTestId("post-title");
const summary = (page: Page) => page.getByTestId("posts-summary");
const tagSelect = (page: Page) => page.getByRole("combobox", { name: "Tag", exact: true });

test("filtering by the Trip tag shows its posts and their totals", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("posts-table", { path: "/posts" });
  await expect(page.getByRole("heading", { level: 1, name: "Posts" })).toBeVisible();
  await expect(rows(page)).toHaveCount(6);

  await tagSelect(page).selectOption("Trip");
  await expect(rows(page)).toHaveCount(4);
  await expect(page).toHaveURL(/[?&]tag=Trip/);
  await expect(summary(page)).toContainText("4 posts");
  // Latest views: 9,100 + 1,200 + 800 (the scheduled post has none yet).
  await expect(summary(page).locator('[data-metric="views"] b')).toHaveText("11.1K");

  // The filtered view survives a reload (it lives in the URL).
  await page.reload();
  await expect(rows(page)).toHaveCount(4);
  await expect(tagSelect(page)).toHaveValue("Trip");
});

test("sorting by views at the same age", async ({ page, loadScenario }) => {
  await loadScenario("posts-table", { path: "/posts" });
  await page.getByRole("button", { name: "Views" }).click();
  await expect(titles(page).first()).toHaveText("Paris in 3 days for under €300");
  await expect(titles(page).last()).toHaveText("Rome's best free viewpoints");

  await page.getByRole("combobox", { name: "Stats at" }).selectOption("24h");
  await expect(page).toHaveURL(/[?&]at=24h/);
  await expect(titles(page)).toHaveText([
    "Paris in 3 days for under €300",
    "How the moon causes tides",
    "Which Tokyo line is fastest?",
    "Budget a weekend trip in a minute",
    "Desk setup tour",
    "Rome's best free viewpoints",
  ]);
  await expect(rows(page).first().locator('[data-metric="views"]')).toHaveText("5.4K");
});

test("tagging selected posts", async ({ page, loadScenario }) => {
  await loadScenario("posts-table", { path: "/posts" });
  await page.getByRole("checkbox", { name: "Select Desk setup tour" }).check();
  await page.getByRole("checkbox", { name: "Select How the moon causes tides" }).check();
  await expect(page.getByRole("region", { name: "Selected posts" })).toContainText("2 selected");
  await page.getByLabel("Tag to add or remove").fill("Ads");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByTestId("toast")).toContainText("Tagged 2 posts");

  await page.reload();
  await tagSelect(page).selectOption("Ads");
  // Newest first: the upload went out 4 days ago, the tides video 5.
  await expect(titles(page)).toHaveText(["Desk setup tour", "How the moon causes tides"]);
});
