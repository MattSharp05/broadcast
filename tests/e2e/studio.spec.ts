import type { Page } from "@playwright/test";
import { stableUuid } from "../../src/lib/hash";
import { expect, test } from "./fixtures";

// BC-36/37: the studio on the Sandbox. The Versions tab plays a version, takes notes on the
// frame, sends them as a batch, and the fake runner answers with the next version at once.

const videoPage = (name: string) => `/factory/${stableUuid(name, "production", "tides")}`;

for (const name of ["factory-versions", "factory-batch-sent", "factory-batch-answered"]) {
  test(`${name} opens the video`, async ({ page, loadScenario }) => {
    await loadScenario(name, { path: videoPage(name) });
    await expect(
      page.getByRole("heading", { level: 1, name: "How the moon causes tides" }),
    ).toBeVisible();
  });
}

const frame = (page: Page) => page.getByTestId("frame");
const notes = (page: Page) => page.getByTestId("note");

async function addNoteAt(page: Page, text: string, gesture: "click" | "drag") {
  await frame(page).scrollIntoViewIfNeeded();
  const box = await frame(page).boundingBox();
  if (!box) throw new Error("no frame");
  if (gesture === "click") {
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
  } else {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7, { steps: 5 });
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.8, { steps: 5 });
    await page.mouse.up();
  }
  const form = page.getByTestId("note-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Note").fill(text);
  await form.getByRole("button", { name: "Add note" }).click();
  await expect(form).toHaveCount(0);
}

async function addGeneral(page: Page, text: string) {
  await page.getByRole("button", { name: "General note" }).click();
  const form = page.getByTestId("note-form");
  await form.getByLabel("Note").fill(text);
  await form.getByRole("button", { name: "Add note" }).click();
  await expect(form).toHaveCount(0);
}

test("notes on the frame, sent as a batch, come back answered in the next version", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-versions", { path: videoPage("factory-versions") });
  await expect(page.getByRole("tab", { name: /Versions/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const versions = page.getByRole("radiogroup", { name: "Versions" });
  await expect(versions.locator('[data-version="2"]')).toHaveAttribute("aria-checked", "true");

  // A moment note three frames in, a region note, a general note.
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Forward one frame" }).click();
  await expect(page.getByTestId("timecode")).toContainText("00:00.03");
  await addNoteAt(page, "The title lands a beat late.", "click");
  await expect(notes(page)).toHaveCount(1);
  await expect(notes(page).first()).toContainText("Moment at 00:00.03");
  await addNoteAt(page, "Make this label bigger.", "drag");
  await expect(notes(page).nth(1)).toContainText("Region at 00:00.03");
  await addGeneral(page, "The music is a little loud.");
  await expect(notes(page)).toHaveCount(3);
  await expect(notes(page).first()).toHaveAttribute("data-number", "1");
  // Badges on the frame for the moment and the region (both at this time).
  await expect(frame(page).getByTestId("note-badge")).toHaveCount(2);

  await page.getByRole("button", { name: "Send notes (3)" }).click();
  // The fake runner answers at once: v3 is shown.
  await expect(versions.locator('[data-version="3"]')).toHaveAttribute("aria-checked", "true");
  await versions.locator('[data-version="2"]').click();
  await expect(page.getByTestId("reply")).toHaveCount(3);
  await expect(notes(page).first()).toHaveAttribute("data-status", "answered");
  await expect(notes(page).first()).toContainText("Answered in v3");
  await expect(page.getByTestId("activity")).toContainText(
    "Answering each note on the frame it points at",
  );
  await expect(page.getByTestId("activity")).toContainText("Sent 3 notes on v2.");

  // Happy with note 1: resolved. Not happy with note 2: a new draft on v3.
  await notes(page).first().getByRole("button", { name: "Resolve" }).click();
  await expect(notes(page).first()).toHaveAttribute("data-status", "resolved");
  await notes(page).nth(1).getByRole("button", { name: "Reopen on v3" }).click();
  await versions.locator('[data-version="3"]').click();
  await expect(notes(page)).toHaveCount(1);
  await expect(notes(page).first()).toHaveAttribute("data-status", "draft");
});

test("note numbers stay put when a draft is deleted, and a sent note can't be edited", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-versions", { path: videoPage("factory-versions") });
  await addGeneral(page, "One");
  await addGeneral(page, "Two");
  await addGeneral(page, "Three");
  await notes(page).nth(1).getByRole("button", { name: "Delete" }).click();
  await expect(notes(page)).toHaveCount(2);
  await expect(notes(page).nth(0)).toHaveAttribute("data-number", "1");
  await expect(notes(page).nth(1)).toHaveAttribute("data-number", "3");
  await addGeneral(page, "Four");
  await expect(notes(page).nth(2)).toHaveAttribute("data-number", "4");

  await loadScenario("factory-batch-sent", { path: videoPage("factory-batch-sent") });
  await expect(notes(page)).toHaveCount(3);
  await expect(notes(page).first()).toHaveAttribute("data-status", "sent");
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Send notes/ })).toBeDisabled();
  await expect(page.getByTestId("batch-open")).toContainText("3 notes are with Claude");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the player and notes fit 390 px, and a touch drag makes a region note", async ({
    page,
    loadScenario,
  }) => {
    await loadScenario("factory-batch-answered", { path: videoPage("factory-batch-answered") });
    await expect(page.getByTestId("frame")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const box = await frame(page).boundingBox();
    if (!box) throw new Error("no frame");
    const at = (fx: number, fy: number) => ({
      clientX: box.x + box.width * fx,
      clientY: box.y + box.height * fy,
      pointerType: "touch",
      pointerId: 7,
      isPrimary: true,
      bubbles: true,
    });
    await frame(page).dispatchEvent("pointerdown", at(0.2, 0.3));
    await frame(page).dispatchEvent("pointermove", at(0.5, 0.45));
    await frame(page).dispatchEvent("pointerup", at(0.7, 0.55));
    const form = page.getByTestId("note-form");
    await expect(form).toContainText("New region note");
    await form.getByLabel("Note").fill("Brighter here.");
    await form.getByRole("button", { name: "Add note" }).click();
    await expect(notes(page).filter({ hasText: "Brighter here." })).toContainText("Region at");
  });
});
