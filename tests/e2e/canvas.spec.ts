import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// BC-11: the Workflow canvas content (account band, upcoming and posted cards, arrows, countdowns)
// on the canvas-busy and empty scenarios, at the mockup's "Now: Thu 5 Nov, 22:14".

const MOCKUP_ORDER = ["codingjourney", "trip.app", "ai.explained.daily", "tri.weekly", "driftship"];

const canvas = (page: Page) => page.getByRole("region", { name: "Workflow canvas" });
const columns = (page: Page) => page.locator("[data-column]");
const column = (page: Page, handle: string) => page.locator(`[data-column="${handle}"]`);
const header = (page: Page, handle: string) => page.locator(`[data-account="${handle}"]`);
const tagSelect = (page: Page) => page.getByRole("combobox", { name: "Tag" });

async function columnOrder(page: Page) {
  return columns(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-column")));
}

async function top(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no bounding box");
  return b;
}

test.describe("canvas-busy", () => {
  test.beforeEach(async ({ page, loadScenario }) => {
    await loadScenario("canvas-busy");
    await expect(canvas(page)).toHaveAttribute("data-ready", "true");
  });

  test("shows the five accounts in order on the band, with the now tag and countdowns", async ({
    page,
  }) => {
    expect(await columnOrder(page)).toEqual(MOCKUP_ORDER);
    await expect(page.locator("[data-now-tag]")).toHaveText("Now: Thu 5 Nov, 22:14");

    const cj = header(page, "codingjourney");
    await expect(cj).toContainText("@codingjourney");
    await expect(cj).toContainText("Coding Journey, Instagram");
    await expect(cj).toContainText("1.2K followers");
    await expect(cj).toContainText("10 in backlog");
    await expect(column(page, "codingjourney").locator("[data-chip]")).toHaveText(
      "Next in 10h 46m",
    );

    const tri = header(page, "tri.weekly");
    await expect(tri).toHaveAttribute("data-attention", "");
    await expect(tri).toContainText("Needs reconnecting");
    await expect(column(page, "tri.weekly").locator("[data-chip]")).toHaveText("Paused");
  });

  test("puts upcoming cards above the line and posted ones below, joined by arrows", async ({
    page,
  }) => {
    for (const handle of MOCKUP_ORDER) {
      const col = column(page, handle);
      const h = await top(header(page, handle));
      const up = col.locator(
        '[data-kind="scheduled"], [data-kind="pinned"], [data-kind="paused"], [data-kind="open"]',
      );
      const past = col.locator('[data-kind="posted"], [data-kind="failed"]');
      await expect(up).toHaveCount(4);
      await expect(past).toHaveCount(5);
      // The next post sits nearest the line; posted newest first going down.
      let prev = h.y;
      for (const card of await up.all()) {
        const b = await top(card);
        expect(b.y + b.height).toBeLessThan(prev);
        prev = b.y;
      }
      prev = h.y + h.height;
      for (const card of await past.all()) {
        const b = await top(card);
        expect(b.y).toBeGreaterThan(prev);
        prev = b.y + b.height;
      }
    }

    const cj = column(page, "codingjourney");
    await expect(cj.locator('[data-kind="pinned"]')).toContainText("Tomorrow, 19:00");
    await expect(cj.locator('[data-kind="pinned"]')).toContainText("Fixed time");
    await expect(cj.locator("[data-more]")).toHaveText("6 more in backlog");

    const trip = column(page, "trip.app");
    await expect(trip.locator('[data-kind="open"]')).toHaveCount(2);
    await expect(trip.locator('[data-kind="failed"]')).toContainText(
      "Wrong aspect ratio. Open to fix.",
    );
    await expect(trip.locator('[data-kind="posted"]').first()).toContainText("Today, 12:00");

    // One arrow between each pair of consecutive items, plus the dashed backlog links and tails.
    const arrows = page.locator("svg[data-arrows] path");
    await expect(arrows).toHaveCount(52);
    await expect(page.locator("svg[data-arrows] path[data-ghost]")).toHaveCount(7);
  });

  test("shows the top bar stats", async ({ page, isMobile }) => {
    test.skip(isMobile, "the stats line is hidden on phones");
    const stats = page.locator("header ul");
    await expect(stats).toContainText("21 scheduled");
    await expect(stats).toContainText("Next post in 9 h 46 min");
    await expect(stats).toContainText("9 posted today");
    await expect(stats).toContainText("1 failed");
  });

  test("the tag filter keeps only matching columns", async ({ page }) => {
    await tagSelect(page).selectOption("Sport");
    await expect(columns(page)).toHaveCount(1);
    expect(await columnOrder(page)).toEqual(["tri.weekly"]);
    await tagSelect(page).selectOption({ label: "All accounts" });
    await expect(columns(page)).toHaveCount(5);
    expect(await columnOrder(page)).toEqual(MOCKUP_ORDER);
  });

  test("the profile link opens Instagram in a new tab and nothing else", async ({
    page,
    context,
  }) => {
    await context.route("https://www.instagram.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>Instagram</title>" }),
    );
    const link = header(page, "trip.app").getByRole("link", {
      name: "Open @trip.app on Instagram",
    });
    await expect(link).toHaveAttribute("href", "https://www.instagram.com/trip.app/");
    await expect(link).toHaveAttribute("target", "_blank");

    const url = page.url();
    const view = await page
      .locator("[data-canvas-world]")
      .evaluate((el) => (el as HTMLElement).style.transform);
    const [popup] = await Promise.all([context.waitForEvent("page"), link.click()]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe("https://www.instagram.com/trip.app/");
    await popup.close();
    expect(page.url()).toBe(url);
    expect(context.pages()).toHaveLength(1);
    // The click didn't pan or zoom the canvas either.
    expect(
      await page
        .locator("[data-canvas-world]")
        .evaluate((el) => (el as HTMLElement).style.transform),
    ).toBe(view);
  });

  test("below 60% zoom small text hides (semantic zoom)", async ({ page }) => {
    const world = page.locator("[data-canvas-world]");
    const zoomOut = page.getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < 4; i++) await zoomOut.click();
    await expect(world).toHaveAttribute("data-zoom", "far");
    await expect(column(page, "codingjourney").locator("[data-chip]")).toBeHidden();
    await expect(header(page, "codingjourney").getByText("@codingjourney")).toBeVisible();
  });
});

test("empty: one column with open slots and nothing queued", async ({ page, loadScenario }) => {
  await loadScenario("empty");
  await expect(canvas(page)).toHaveAttribute("data-ready", "true");
  await expect(columns(page)).toHaveCount(1);
  const col = column(page, "example.account");
  await expect(col.locator('[data-kind="open"]')).toHaveCount(4);
  await expect(col.locator('[data-kind="open"]').first()).toContainText("Tomorrow, 09:00");
  await expect(col.locator("[data-chip]")).toHaveText("Nothing queued");
  await expect(col.locator('[data-kind="posted"]')).toHaveCount(0);
});
