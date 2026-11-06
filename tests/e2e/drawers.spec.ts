import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// BC-15: hover previews and detail drawers (post, account with profile link, open slot) on the
// canvas-busy scenario at the mockup's "Now: Thu 5 Nov, 22:14".

const canvas = (page: Page) => page.getByRole("region", { name: "Workflow canvas" });
const column = (page: Page, handle: string) => page.locator(`[data-column="${handle}"]`);
const header = (page: Page, handle: string) => page.locator(`[data-account="${handle}"]`);
const preview = (page: Page) => page.getByTestId("canvas-preview");
const dialog = (page: Page) => page.getByRole("dialog");
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 760;

const PROFILE = "https://www.instagram.com/codingjourney/";

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no bounding box");
  return b;
}

/** Clicks a canvas card where it is (no scrolling: the canvas pans by transform). */
async function clickCard(page: Page, card: Locator) {
  const b = await box(card);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/** Cards off screen: focus and Enter (the canvas pans to a focused card). */
async function openWithKeyboard(page: Page, card: Locator) {
  await card.focus();
  await page.keyboard.press("Enter");
}

async function hoverCard(page: Page, card: Locator) {
  const b = await box(card);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
}

test.describe("canvas-busy", () => {
  test.beforeEach(async ({ page, loadScenario }) => {
    await loadScenario("canvas-busy");
    await expect(canvas(page)).toHaveAttribute("data-ready", "true");
    // Start from the now line so the first posted card of each column is on screen.
    await page.getByRole("button", { name: "Back to now" }).click();
  });

  test("hovering a posted card previews its six numbers beside it; clicking opens the drawer with the chart", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "Previews are for a mouse.");
    const card = column(page, "codingjourney").locator('[data-kind="posted"]').first();
    await hoverCard(page, card);
    await expect(preview(page)).toBeVisible();
    for (const label of ["Views", "Likes", "Comments", "Shares", "Saves", "Reach"]) {
      await expect(preview(page).getByText(label, { exact: true })).toBeVisible();
    }
    await expect(preview(page)).toContainText(/Stats refreshed .* ago/);

    // Beside the card, never over it.
    const c = await box(card);
    const p = await box(preview(page));
    const overlap =
      p.x < c.x + c.width && p.x + p.width > c.x && p.y < c.y + c.height && p.y + p.height > c.y;
    expect(overlap).toBe(false);

    await page.mouse.move(5, 300);
    await expect(preview(page)).toHaveCount(0);

    await clickCard(page, card);
    const drawer = page.getByTestId("drawer-posted");
    await expect(drawer).toBeVisible();
    await expect(dialog(page)).toHaveAttribute("aria-modal", "true");
    await expect(drawer.locator('[data-chart="refreshes"]')).toBeVisible();
    await expect(drawer.locator('[data-numbers="performance"] dd')).toHaveCount(6);
    await expect(drawer.getByRole("link", { name: "Open the post" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  test("Escape closes the drawer and gives focus back to the card", async ({ page }) => {
    const card = column(page, "codingjourney").locator('[data-kind="posted"]').first();
    await clickCard(page, card);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(card).toBeFocused();

    // The scrim closes it too.
    await clickCard(page, card);
    await expect(dialog(page)).toBeVisible();
    await page.locator("[data-drawer-scrim]").click({ position: { x: 10, y: 10 } });
    await expect(dialog(page)).toHaveCount(0);
  });

  test("Enter on a focused card opens its drawer; Tab stays inside the drawer", async ({
    page,
  }) => {
    const card = column(page, "codingjourney").locator('[data-kind="posted"]').first();
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    expect(await dialog(page).evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(card).toBeFocused();
  });

  test("the account drawer links to the profile in a new tab, and Copy link copies it", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    if (isDesktop(page)) {
      await hoverCard(page, header(page, "codingjourney"));
      await expect(preview(page)).toContainText("of 100 daily posts used");
      await expect(preview(page)).toContainText("Views, 7 days");
    }
    const handle = header(page, "codingjourney").getByText("@codingjourney", { exact: true });
    await handle.click();
    const drawer = page.getByTestId("drawer-account");
    await expect(drawer).toBeVisible();
    const open = drawer.getByRole("link", { name: "Open @codingjourney on Instagram" });
    await expect(open).toHaveAttribute("href", PROFILE);
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(drawer.locator('[data-chart="followers"]')).toBeVisible();
    await expect(drawer.getByRole("link", { name: "instagram.com/codingjourney" })).toHaveAttribute(
      "href",
      PROFILE,
    );

    await drawer.getByRole("button", { name: "Copy link" }).click();
    await expect(drawer.getByRole("button", { name: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PROFILE);
  });

  test("a failed post shows the full error; an open slot explains itself; an account needing attention says why", async ({
    page,
  }) => {
    await openWithKeyboard(page, column(page, "trip.app").locator('[data-kind="failed"]').first());
    await expect(page.getByTestId("drawer-failed")).toContainText("Reels must be 9:16");
    await page.keyboard.press("Escape");

    await openWithKeyboard(page, column(page, "trip.app").locator('[data-kind="open"]').first());
    const slot = page.getByTestId("drawer-open");
    await expect(slot).toContainText("When this slot comes up");
    await expect(slot.getByRole("button", { name: "Add a video for this slot" })).toBeVisible();
    await page.keyboard.press("Escape");

    await openWithKeyboard(page, header(page, "tri.weekly"));
    await expect(page.getByTestId("drawer-account")).toContainText("Instagram access expired");
  });

  test("Details on the Accounts tab opens the same account drawer", async ({ page }) => {
    await page.goto("/accounts");
    const button = page.getByRole("button", { name: "Details for @driftship" });
    await button.click();
    const drawer = page.getByTestId("drawer-account");
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("link", { name: "Open @driftship on Instagram" }),
    ).toHaveAttribute("href", "https://www.instagram.com/driftship/");
    await page.keyboard.press("Escape");
    await expect(button).toBeFocused();
  });
});
