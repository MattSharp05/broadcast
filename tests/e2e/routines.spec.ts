import type { Page } from "@playwright/test";
import { stableUuid } from "../../src/lib/hash";
import { expect, test } from "./fixtures";

// Routines (ADR 0009): from a template to a plan, approving the plan (the due videos build at
// once in the Sandbox), approving a finished video, and a routine that posts on its own.

const routinePage = (name: string) => `/routines/${stableUuid(name, "routine", "weekend")}`;
const slots = (page: Page) => page.getByTestId("routine-slot");
const status = (page: Page) => page.getByTestId("routine-status");

test("a routine from a template: save, plan the videos, see one brief per slot", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("routine-template", { path: "/routines" });
  await expect(page.getByRole("heading", { level: 1, name: "Routines" })).toBeVisible();
  await page.getByRole("link", { name: "Use for a new routine" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New routine" })).toBeVisible();

  // The template filled the rules: two voices ticked, its mix shown.
  await expect(page.getByText("Voices (2 ticked)")).toBeVisible();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Weekend teasers");
  await page.getByRole("checkbox", { name: /@codingjourney/ }).check();
  // Tomorrow 00:00 to the day after's end: 2 days × 10 posts.
  await expect(page.getByTestId("schedule-preview")).toContainText("20 videos");
  await page.getByRole("radio", { name: /Post automatically/ }).check();
  await page.getByRole("button", { name: "Save routine" }).click();

  await expect(page).toHaveURL(/\/routines\/[0-9a-f-]{36}$/);
  await expect(status(page)).toHaveText("Draft");
  await expect(slots(page)).toHaveCount(20);
  await expect(slots(page).first()).toContainText("Not planned yet");

  await page.getByRole("button", { name: "Plan videos" }).click();
  await expect(page.getByTestId("toast")).toHaveText("Planned every video.");
  await expect(status(page)).toHaveText("Plan ready");
  await expect(slots(page).filter({ hasText: "Not planned yet" })).toHaveCount(0);
  await expect(slots(page).filter({ hasText: "Brainteaser" })).toHaveCount(8);
  await expect(slots(page).filter({ hasText: "Explainer" })).toHaveCount(12);
});

test("approving the plan builds the due videos; a finished one waits, then is scheduled", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("routine-planned", { path: routinePage("routine-planned") });
  await expect(status(page)).toHaveText("Plan ready");
  await page.getByRole("button", { name: "Approve plan and start" }).click();
  await expect(status(page)).toHaveText("Running");

  const waiting = slots(page).filter({ hasText: "Waiting for you" });
  await expect(waiting).toHaveCount(2);
  const first = waiting.first();
  await expect(first.getByRole("link")).toHaveAttribute("href", /^\/factory\//);
  await first.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("toast")).toContainText("scheduled for @codingjourney");
  await expect(slots(page).filter({ hasText: "Scheduled" })).toHaveCount(1);
  await expect(slots(page).filter({ hasText: "Waiting for you" })).toHaveCount(1);
});

test("a routine that posts automatically schedules its due videos and shows past slots", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("routine-running", { path: routinePage("routine-running") });
  await expect(status(page)).toHaveText("Running");
  await expect(page.locator('[data-slot-status="posted"]')).toHaveCount(2);
  await expect(page.locator('[data-slot-status="missed"]')).toHaveCount(1);
  await expect(page.locator('[data-slot-status="failed"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByTestId("toast")).toContainText("2 scheduled");
  await expect(page.locator('[data-slot-status="scheduled"]')).toHaveCount(2);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(status(page)).toHaveText("Paused");
});
