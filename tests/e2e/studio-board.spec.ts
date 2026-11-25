import { stableUuid } from "../../src/lib/hash";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// BC-40: the Board tab on the Sandbox: five storyboard cards at the visuals step, edited,
// reordered and approved (the fake runner starts the next step), or a card redone.

const boardPage = `/factory/${stableUuid("factory-board", "production", "tides")}?tab=board`;
const cards = (page: Page) => page.getByTestId("card");

test("edit a card's seconds, move card 4 up, approve the board → the next step starts", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-board", { path: boardPage.split("?")[0] });
  await page.goto(boardPage);
  await expect(cards(page)).toHaveCount(5);
  await expect(page.getByTestId("board-total")).toContainText("60 s in all");

  const seconds = page.getByLabel("Card 2 seconds");
  await seconds.fill("10");
  await seconds.press("Enter");
  await expect(page.getByTestId("board-total")).toContainText("56 s in all");

  await expect(cards(page).nth(3)).toHaveAttribute("data-scene", "s4");
  await page.getByRole("button", { name: "Move card 4 up" }).click();
  await expect(cards(page).nth(2)).toHaveAttribute("data-scene", "s4");
  await expect(cards(page).nth(3)).toHaveAttribute("data-scene", "s3");

  await page.getByRole("button", { name: "Approve board" }).click();
  await expect(page.getByTestId("board-approved")).toBeVisible();
  await page.getByRole("tab", { name: "Make" }).click();
  await expect(page.locator('[data-step="visuals"]')).toHaveAttribute("data-status", "approved");
  // The fake runner renders at once: the render waits for approval.
  await expect(page.locator('[data-step="render"]')).toHaveAttribute("data-status", "waiting");
});

test("Redo this card on card 3 asks for a scene rework of that scene", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-board", { path: boardPage.split("?")[0] });
  await page.goto(boardPage);
  await cards(page).nth(2).getByRole("button", { name: "Redo this card" }).click();
  await page.getByLabel("What to change on card 3").fill("Slower, so each label reads");
  await page.getByRole("button", { name: "Redo scene s3" }).click();
  await page.getByRole("tab", { name: "Make" }).click();
  await expect(page.getByTestId("reworks")).toContainText("s3: Slower, so each label reads");
});
