import { expect, test } from "@playwright/test";

// BC-7: the Content Factory placeholder tab. Static: a callout, a 4-column example board and a
// disabled "New idea" button. Runs on every project (desktop and phone).

test.beforeEach(async ({ page }) => {
  await page.goto("/factory");
});

test("shows the callout, the four example columns and a disabled New idea button", async ({
  page,
}) => {
  await expect(page.getByRole("heading", { level: 1, name: "Content Factory" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Placeholder until v1" })).toBeVisible();
  await expect(page.getByText(/Add content on the Workflow tab or through the API/)).toBeVisible();

  const board = page.getByRole("region", { name: "Example board" });
  await expect(board).toBeVisible();
  await expect(page.getByText(/Example board: these cards show how ideas will move/)).toBeVisible();

  const columns = board.getByRole("heading", { level: 3 });
  await expect(columns).toHaveText([
    /^Ideas\s*3$/,
    /^Scripting\s*2$/,
    /^In video-editor\s*1$/,
    /^Ready for the queue\s*1$/,
  ]);
  await expect(board.locator("[data-example]")).toHaveCount(7);

  await expect(page.getByRole("button", { name: "New idea" })).toBeDisabled();
});

test("at 390px the board scrolls inside its own container, not the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/factory");

  const board = page.getByRole("region", { name: "Example board" });
  await expect(board).toBeVisible();

  const sizes = await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('[data-testid="factory-board"]');
    const doc = document.scrollingElement ?? document.documentElement;
    const main = document.querySelector("main");
    return {
      boardScroll: b ? b.scrollWidth - b.clientWidth : 0,
      boardClipped: b ? b.scrollHeight - b.clientHeight : 0,
      pageScroll: doc.scrollWidth - doc.clientWidth,
      mainScroll: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  expect(sizes.boardScroll).toBeGreaterThan(0);
  expect(sizes.boardClipped, "columns are cut off at the bottom").toBeLessThanOrEqual(0);
  expect(sizes.pageScroll).toBeLessThanOrEqual(0);
  expect(sizes.mainScroll).toBeLessThanOrEqual(0);

  // The last column can be reached by scrolling the board.
  await board.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(board.getByRole("heading", { name: /Ready for the queue/ })).toBeInViewport();
});
