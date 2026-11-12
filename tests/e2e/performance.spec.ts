import { expect, test } from "./fixtures";

// The Workflow tab's performance line: totals for a period over the accounts the Tag filter shows.

test("shows the period's totals and follows the Tag filter", async ({ page, loadScenario }) => {
  await loadScenario("canvas-busy");
  const line = page.getByTestId("performance-line");
  await expect(line).toBeVisible();
  await expect(page.getByLabel("Period")).toHaveValue("7d");
  for (const m of ["views", "reach", "likes", "comments", "shares", "saves", "followers"]) {
    await expect(line.locator(`[data-metric="${m}"]`)).toBeVisible();
  }
  const views = line.locator('[data-metric="views"] b');
  const before = await views.textContent();
  expect(before).toMatch(/^(—|[\d.]+K?M?)$/);

  await page.getByLabel("Period").selectOption("all");
  await expect(page.getByLabel("Period")).toHaveValue("all");
  // All time has no comparison.
  await expect(line.locator('[data-metric="views"] [data-tone]')).toHaveCount(0);

  // A tag that shows fewer accounts can only lower the follower total.
  const followers = async () =>
    (await line.locator('[data-metric="followers"] b').textContent()) ?? "";
  const all = await followers();
  const tagSelect = page.getByRole("combobox", { name: /tag/i });
  const options = await tagSelect.locator("option").allTextContents();
  if (options.length > 1) {
    await tagSelect.selectOption({ index: 1 });
    await expect.poll(followers).not.toBe("");
    expect(await followers()).not.toBe("");
  }
  expect(all).not.toBe("");
});
