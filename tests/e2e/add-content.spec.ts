import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// BC-14: Add content: choose a 9:16 video, caption, accounts and timing; the file goes straight
// to Storage; new cards appear on the canvas with a highlight and a toast. Fixtures are tiny
// H.264 clips in tests/fixtures/video.

const VIDEO = (name: string) => join(process.cwd(), "tests/fixtures/video", name);
const canvas = (page: Page) => page.getByRole("region", { name: "Workflow canvas" });
const dialog = (page: Page) => page.getByTestId("add-content");
const column = (page: Page, handle: string) => page.locator(`[data-column="${handle}"]`);
const pick = (page: Page, handle: string) =>
  dialog(page).locator(`[data-account="${handle}"]`).getByRole("checkbox");

async function openDialog(page: Page) {
  await page.getByTestId("add-content-button").click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("heading", { name: "Add content" })).toBeVisible();
}

async function chooseFile(page: Page, name: string) {
  await dialog(page).getByTestId("add-content-file").setInputFiles(VIDEO(name));
}

/** The time label of a column's first open slot ("Sat 7 Nov, 12:00"). */
async function firstOpenSlot(page: Page, handle: string): Promise<string> {
  const label = await column(page, handle)
    .locator('[data-kind="open"]')
    .first()
    .getAttribute("aria-label");
  const when = label?.replace(/^Open slot, /, "");
  if (!when) throw new Error(`no open slot on @${handle}`);
  return when;
}

test.describe("canvas-busy", () => {
  test.beforeEach(async ({ page, loadScenario }) => {
    await loadScenario("canvas-busy");
    await expect(canvas(page)).toHaveAttribute("data-ready", "true");
  });

  test("a 9:16 MP4 added to two accounts fills each one's first open slot, with a toast", async ({
    page,
  }) => {
    const tripSlot = await firstOpenSlot(page, "trip.app");
    const driftSlot = await firstOpenSlot(page, "driftship");

    await openDialog(page);
    await chooseFile(page, "reel-9x16.mp4");
    await expect(dialog(page)).toContainText("1080 × 1920, 0:04");
    // The thumbnail frame grabbed in the browser.
    await expect(dialog(page).locator("label img")).toHaveAttribute("src", /^blob:/);
    await dialog(page).getByLabel("Caption").fill("Day 42: Add content works");
    await pick(page, "trip.app").check();
    await pick(page, "driftship").check();
    await expect(dialog(page)).toContainText("2 accounts selected");
    await expect(dialog(page).getByTestId("timing-hint")).toHaveText(
      /^The first post goes out .+\.$/,
    );
    await dialog(page).getByRole("button", { name: "Add to queue" }).click();

    await expect(dialog(page)).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("toast")).toHaveText(/^Added to 2 queues\. First post .+\.$/);
    for (const [handle, when] of [
      ["trip.app", tripSlot],
      ["driftship", driftSlot],
    ] as const) {
      const card = column(page, handle).getByRole("button", {
        name: `Day 42: Add content works, Scheduled, ${when}`,
      });
      await expect(card).toHaveCount(1);
      await expect(card).toHaveAttribute("data-fresh", "");
      // The uploaded thumbnail replaces the placeholder (a signed Storage URL that loads).
      const thumb = card.locator("img");
      await expect(thumb).toHaveAttribute("src", /\/storage\/v1\/object\/sign\/videos\//);
      await expect
        .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBe(360);
      await expect(
        column(page, handle).getByRole("button", { name: `Open slot, ${when}` }),
      ).toHaveCount(0);
    }
  });

  test("videos that aren't Reels are refused before uploading, with the reason", async ({
    page,
  }) => {
    await openDialog(page);
    await pick(page, "trip.app").check();
    await chooseFile(page, "portrait-4x5.mp4");
    await expect(dialog(page).getByTestId("media-issues")).toHaveText(
      "This video is 1080 × 1350. Reels must be 9:16 (1080 × 1920).",
    );
    await expect(dialog(page).getByRole("button", { name: "Add to queue" })).toBeDisabled();
    await chooseFile(page, "short-2s.mp4");
    await expect(dialog(page).getByTestId("media-issues")).toHaveText(
      "This video is 2 seconds long. Reels must be 3 to 90 seconds.",
    );
    await expect(dialog(page).getByRole("button", { name: "Add to queue" })).toBeDisabled();
  });

  test("an open slot's Add a video opens Add content for that account", async ({ page }) => {
    const slot = column(page, "trip.app").locator('[data-kind="open"]').first();
    await slot.focus();
    await page.keyboard.press("Enter");
    await page
      .getByTestId("drawer-open")
      .getByRole("button", { name: "Add a video for this slot" })
      .click();
    await expect(dialog(page)).toBeVisible();
    await expect(pick(page, "trip.app")).toBeChecked();
    await expect(pick(page, "driftship")).not.toBeChecked();
    await expect(dialog(page).getByRole("radio", { name: "Next open slot" })).toBeChecked();
  });
});

test.describe("add-content", () => {
  test.beforeEach(async ({ page, loadScenario }) => {
    await loadScenario("add-content");
    await expect(canvas(page)).toHaveAttribute("data-ready", "true");
  });

  test("lists each account's next open slot, or why it waits", async ({ page }) => {
    await openDialog(page);
    await expect(dialog(page).locator('[data-account="codingjourney"]')).toContainText(
      "Next open slot Tomorrow, 19:00",
    );
    await expect(dialog(page).locator('[data-account="trip.app"]')).toContainText(
      "Next open slot Tomorrow, 12:00",
    );
    await expect(dialog(page).locator('[data-account="tri.weekly"]')).toContainText("Paused");
    await expect(dialog(page).locator('[data-account="driftship"]')).toContainText("No slots yet");
  });

  test("pinning adds a Pinned card at that time; the queued cards keep theirs", async ({
    page,
  }) => {
    const queued = column(page, "codingjourney").locator('[data-kind="scheduled"]');
    await expect(queued).toHaveCount(2);
    const before = await queued.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));

    await openDialog(page);
    await chooseFile(page, "reel-9x16.mp4");
    await dialog(page).getByLabel("Caption").fill("Pinned launch video");
    await pick(page, "codingjourney").check();
    await dialog(page).getByRole("radio", { name: "Pin to a time" }).check();
    await dialog(page).getByLabel("Pinned time").fill("2026-11-06T11:30");
    await expect(dialog(page).getByTestId("timing-hint")).toHaveText(
      "Posts Tomorrow, 11:30 on @codingjourney.",
    );
    await dialog(page).getByRole("button", { name: "Pin post" }).click();

    await expect(dialog(page)).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId("toast")).toHaveText(
      "Added to 1 queue. First post Tomorrow, 11:30.",
    );
    await expect(
      column(page, "codingjourney").getByRole("button", {
        name: "Pinned launch video, Pinned, Tomorrow, 11:30",
      }),
    ).toHaveCount(1);
    await expect(queued).toHaveCount(2);
    expect(await queued.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(
      before,
    );
  });

  test("a pinned time in the past is refused", async ({ page }) => {
    await openDialog(page);
    await chooseFile(page, "reel-9x16.mp4");
    await pick(page, "trip.app").check();
    await dialog(page).getByRole("radio", { name: "Pin to a time" }).check();
    await dialog(page).getByLabel("Pinned time").fill("2026-11-05T09:00");
    await expect(dialog(page).getByTestId("timing-hint")).toHaveText(
      "That time has passed. Choose a later one.",
    );
    await expect(dialog(page).getByRole("button", { name: "Pin post" })).toBeDisabled();
  });
});
