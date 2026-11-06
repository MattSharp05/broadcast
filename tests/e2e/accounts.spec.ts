import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// BC-10: the Accounts table (grouped by brand, sort, filter, inline tags and descriptions) on the
// canvas-busy scenario (the mockup's five accounts) and the no-accounts empty state.

const table = (page: Page) => page.getByRole("table", { name: "Accounts" });
const groups = (page: Page) => page.locator("tr[data-brand]");
const rows = (page: Page) => page.locator("tr[data-account]");
const row = (page: Page, handle: string) => page.locator(`tr[data-account="${handle}"]`);
const tagSelect = (page: Page) => page.getByRole("combobox", { name: "Tag" });
const statusSelect = (page: Page) => page.getByRole("combobox", { name: "Status" });

async function handles(page: Page) {
  return rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-account")));
}

test.describe("canvas-busy", () => {
  test.beforeEach(async ({ page, loadScenario }) => {
    await loadScenario("canvas-busy", { path: "/accounts" });
    await expect(table(page)).toBeVisible();
  });

  test("groups the five accounts by brand, A–Z, with the top bar stats", async ({ page }) => {
    await expect(groups(page)).toHaveCount(5);
    expect(
      await groups(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-brand"))),
    ).toEqual(["Coding Journey", "Driftship", "Explainers", "Sport", "Trip"]);
    await expect(groups(page).first()).toContainText("1 account");
    expect(await handles(page)).toEqual([
      "codingjourney",
      "driftship",
      "ai.explained.daily",
      "tri.weekly",
      "trip.app",
    ]);

    const cj = row(page, "codingjourney");
    await expect(cj).toContainText("Instagram");
    await expect(cj).toContainText("Ready");
    await expect(cj).toContainText("1,240");
    await expect(cj.locator("td").nth(5)).toHaveText("3");
    const tri = row(page, "tri.weekly");
    await expect(tri).toContainText("Needs attention");
    await expect(tri).toContainText("Instagram access expired on 2 Nov.");

    if ((page.viewportSize()?.width ?? 0) >= 760) {
      const stats = page.locator("header ul");
      await expect(stats).toContainText("5 accounts");
      await expect(stats).toContainText("4 ready to publish");
      await expect(stats).toContainText("1 needs attention");
    }
    await expect(page.getByRole("button", { name: "Add account" })).toBeDisabled();
  });

  test("handles open the Instagram profile in a new tab", async ({ page }) => {
    const link = row(page, "trip.app").getByRole("link", { name: "@trip.app" });
    await expect(link).toHaveAttribute("href", "https://www.instagram.com/trip.app/");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("sorting by followers or account flattens the groups; a third click regroups", async ({
    page,
  }) => {
    const followers = page.getByRole("button", { name: "Followers" });
    await followers.click();
    await expect(groups(page)).toHaveCount(0);
    expect(await handles(page)).toEqual([
      "ai.explained.daily",
      "driftship",
      "codingjourney",
      "tri.weekly",
      "trip.app",
    ]);
    await followers.click();
    expect(await handles(page)).toEqual([
      "trip.app",
      "tri.weekly",
      "codingjourney",
      "driftship",
      "ai.explained.daily",
    ]);
    await followers.click();
    await expect(groups(page)).toHaveCount(5);

    await page.getByRole("button", { name: "Account", exact: true }).click();
    expect(await handles(page)).toEqual([
      "ai.explained.daily",
      "codingjourney",
      "driftship",
      "tri.weekly",
      "trip.app",
    ]);
  });

  test("search, Tag and Status filter the rows", async ({ page }) => {
    await statusSelect(page).selectOption({ label: "Needs attention" });
    expect(await handles(page)).toEqual(["tri.weekly"]);
    await statusSelect(page).selectOption({ label: "All" });

    await tagSelect(page).selectOption({ label: "App (2)" });
    expect(await handles(page)).toEqual(["driftship", "trip.app"]);
    await tagSelect(page).selectOption({ label: "All tags" });

    await page.getByRole("searchbox", { name: "Search accounts" }).fill("half-ironman");
    expect(await handles(page)).toEqual(["tri.weekly"]);
    await page.getByRole("searchbox", { name: "Search accounts" }).fill("nothing like this");
    await expect(table(page)).toContainText("No accounts match these filters.");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(rows(page)).toHaveCount(5);
  });

  test("a tag added to @trip.app persists and joins both Tag filters", async ({ page }) => {
    const trip = row(page, "trip.app");
    await trip.getByRole("button", { name: "Add tag to @trip.app" }).click();
    const input = trip.getByRole("combobox", { name: "New tag for @trip.app" });
    await input.fill("Launch");
    await input.press("Enter");
    await expect(trip.getByText("Launch", { exact: true })).toBeVisible();
    await expect(tagSelect(page).locator("option", { hasText: "Launch (1)" })).toHaveCount(1);

    await page.reload();
    await expect(row(page, "trip.app").getByText("Launch", { exact: true })).toBeVisible();
    await tagSelect(page).selectOption({ label: "Launch (1)" });
    expect(await handles(page)).toEqual(["trip.app"]);

    await page.goto("/workflow");
    await expect(tagSelect(page).locator("option", { hasText: "Launch" })).toHaveCount(1);
  });

  test("Escape cancels a new tag; × removes one and it stays removed", async ({ page }) => {
    const trip = row(page, "trip.app");
    await trip.getByRole("button", { name: "Add tag to @trip.app" }).click();
    const input = trip.getByRole("combobox", { name: "New tag for @trip.app" });
    await input.fill("Nope");
    await input.press("Escape");
    await expect(trip.getByText("Nope")).toHaveCount(0);
    await expect(trip.getByRole("button", { name: "Add tag to @trip.app" })).toBeFocused();

    await trip.getByRole("button", { name: "Remove tag Product" }).click();
    await expect(trip.getByText("Product", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(row(page, "trip.app").getByText("App", { exact: true })).toBeVisible();
    await expect(row(page, "trip.app").getByText("Product", { exact: true })).toHaveCount(0);
  });

  test("a description autosaves, says Saved and persists", async ({ page }) => {
    const desc = row(page, "driftship").getByRole("textbox", {
      name: "Description for @driftship",
    });
    await desc.fill("Driftship tips, one a day.");
    // "Saved" sits under the textarea without taking room (0-height line, like the mockup).
    await expect(row(page, "driftship").locator("[aria-live]")).toHaveText("Saved");
    await page.reload();
    await expect(
      row(page, "driftship").getByRole("textbox", { name: "Description for @driftship" }),
    ).toHaveValue("Driftship tips, one a day.");
  });

  test("New brand adds a group; Rename brand renames one", async ({ page }) => {
    await page.getByRole("button", { name: "New brand" }).click();
    await page.getByRole("textbox", { name: "New brand name" }).fill("Kart Racer");
    await page.getByRole("textbox", { name: "New brand name" }).press("Enter");
    await expect(page.locator('tr[data-brand="Kart Racer"]')).toContainText("0 accounts");

    await page.getByRole("button", { name: "Brand options for Trip" }).click();
    await page.getByRole("menuitem", { name: "Rename brand" }).click();
    const name = page.getByRole("textbox", { name: "New name for Trip" });
    await name.fill("Trip app");
    await name.press("Enter");
    await expect(page.locator('tr[data-brand="Trip app"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('tr[data-brand="Trip app"]')).toContainText("1 account");
    await expect(page.locator('tr[data-brand="Kart Racer"]')).toBeVisible();
  });
});

test("no-accounts shows the empty state", async ({ page, loadScenario }) => {
  await loadScenario("no-accounts", { path: "/accounts" });
  await expect(
    page.getByText("No accounts yet. Add your first account to start posting."),
  ).toBeVisible();
  await expect(table(page)).toHaveCount(0);

  // A brand without accounts gets its group row, with the hint below the table.
  await page.getByRole("button", { name: "New brand" }).click();
  await page.getByRole("textbox", { name: "New brand name" }).fill("Kart Racer");
  await page.getByRole("button", { name: "Create brand" }).click();
  await expect(page.locator('tr[data-brand="Kart Racer"]')).toContainText("0 accounts");
  await expect(
    page.getByText("No accounts yet. Add your first account to start posting."),
  ).toBeVisible();

  await page.getByRole("button", { name: "New brand" }).click();
  await page.getByRole("textbox", { name: "New brand name" }).fill("kart racer");
  await page.getByRole("textbox", { name: "New brand name" }).press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "already" })).toHaveText(
    "There is already a brand called Kart Racer.",
  );
});
