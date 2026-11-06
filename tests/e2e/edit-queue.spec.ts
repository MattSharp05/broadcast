import type { Locator, Page } from "@playwright/test";
import { stableUuid } from "../../src/lib/hash";
import { expect, test } from "./fixtures";

// BC-18: editing the queue from the drawers on canvas-busy: remove (later posts move up), pin
// (stays put), slots (a new open slot), and "Post now" published by the scheduler's tick.

const id = (...parts: string[]) => stableUuid("canvas-busy", ...parts);
const queued = (i: number) => id("post", "cj", "q", String(i));
const card = (page: Page, postId: string) => page.locator(`[data-post="${postId}"]`);
const drawer = (page: Page) => page.getByRole("dialog");
const toast = (page: Page) => page.getByTestId("toast");

/** "Today, 09:00" from a card's label ("Title, Scheduled, Today, 09:00"). */
async function when(locator: Locator): Promise<string> {
  const label = (await locator.getAttribute("aria-label")) ?? "";
  return label.split(/, (?:Scheduled|Pinned|Paused|Publishing), /)[1] ?? "";
}

/** Focus and Enter: works wherever the card is on the canvas, on any device. */
async function open(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press("Enter");
  await expect(drawer(page)).toBeVisible();
}

async function ready(page: Page) {
  await expect(page.getByRole("region", { name: "Workflow canvas" })).toHaveAttribute(
    "data-ready",
    "true",
  );
}

async function removeFromQueue(page: Page, postId: string) {
  await open(page, card(page, postId));
  await drawer(page).getByRole("button", { name: "Remove from queue" }).click();
  await drawer(page).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(toast(page)).toHaveText(
    "Removed from @codingjourney's queue. Later posts moved up.",
  );
  await expect(drawer(page)).toHaveCount(0);
  await expect(card(page, postId)).toHaveCount(0);
}

test("removing the 1st queued post of @codingjourney moves the 2nd into its slot", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("canvas-busy");
  await ready(page);
  const firstSlot = await when(card(page, queued(0)));
  expect(firstSlot).toBe("Tomorrow, 09:00");

  await removeFromQueue(page, queued(0));
  await expect(card(page, queued(1))).toHaveAttribute("aria-label", new RegExp(`, ${firstSlot}$`));
});

test("a post switched to Pinned keeps its time after other queue changes", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("canvas-busy");
  await ready(page);

  await open(page, card(page, queued(2)));
  await drawer(page).getByLabel("Caption").fill("Pinned for the afternoon");
  await drawer(page).getByRole("radio", { name: "Pinned time" }).check();
  await drawer(page).getByLabel("Pinned date and time").fill("2026-11-06T16:30");
  await drawer(page).getByRole("button", { name: "Save changes" }).click();
  await expect(toast(page)).toHaveText("Changes saved. Pinned to Tomorrow, 16:30.");
  // The open drawer follows the saved post.
  await expect(drawer(page)).toContainText("Tomorrow, 16:30");
  await page.keyboard.press("Escape");

  await removeFromQueue(page, queued(0));
  const pinned = card(page, queued(2));
  await expect(pinned).toHaveAttribute("data-kind", "pinned");
  await expect(pinned).toHaveAttribute(
    "aria-label",
    /^Pinned for the afternoon, Pinned, Tomorrow, 16:30$/,
  );
  await expect(card(page, queued(1))).toHaveAttribute("aria-label", /, Tomorrow, 09:00$/);
});

test("adding a 21:00 slot shows a new open slot today when it's before 21:00", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("canvas-busy", { now: "2026-11-05T10:00:00Z" });
  await ready(page);
  const trip = id("account", "trip");
  const openSlot = page.locator(`[data-post="open-${trip}-2026-11-05T21:00:00.000Z"]`);
  await expect(openSlot).toHaveCount(0);

  await open(page, page.locator('[data-account="trip.app"]'));
  await drawer(page).getByLabel("New slot time").fill("21:00");
  await drawer(page).getByRole("button", { name: "Add slot" }).click();
  await expect(drawer(page).locator('[data-slot="21:00"]')).toBeVisible();
  await expect(toast(page)).toHaveText("Added a 21:00 slot to @trip.app.");
  await expect(openSlot).toHaveAttribute("aria-label", "Open slot, Today, 21:00");

  await drawer(page).getByRole("button", { name: "Remove slot 21:00" }).click();
  await expect(toast(page)).toHaveText("Removed the 21:00 slot from @trip.app.");
  await expect(openSlot).toHaveCount(0);
});

test("Post now, then Run tick now (Sandbox), publishes it", async ({ page, loadScenario }) => {
  await loadScenario("canvas-busy");
  await ready(page);
  await open(page, card(page, queued(0)));
  await expect(drawer(page)).toContainText(
    "@codingjourney has used 3 of its 100 posts in the last 24 hours.",
  );
  await drawer(page).getByRole("button", { name: "Post now" }).click();
  await expect(toast(page)).toHaveText("Posting now. The scheduler publishes it within a minute.");
  await expect(card(page, queued(0))).toHaveAttribute("aria-label", /, Pinned, Today, 22:14$/);
  await expect(card(page, queued(1))).toHaveAttribute("aria-label", /, Tomorrow, 09:00$/);

  // The fake provider uploads, processes, then publishes: tick until it's out (as the cron would).
  await page.goto("/dev");
  const result = page.getByTestId("tick-result");
  await page.getByRole("button", { name: "Run tick now" }).click();
  await expect(result).toHaveText("Tick done: 1 uploaded.");
  for (let run = 2; run <= 6; run++) {
    await page.getByRole("button", { name: "Run tick now" }).click();
    await expect(result).toHaveAttribute("data-runs", String(run));
    await expect(result).toHaveText(/Tick done: 1 (still processing|published)\./);
    if ((await result.textContent()) === "Tick done: 1 published.") break;
  }
  await expect(result).toHaveText("Tick done: 1 published.");

  await page.goto("/workflow");
  await ready(page);
  await expect(card(page, queued(0))).toHaveAttribute("data-kind", "posted");
});
