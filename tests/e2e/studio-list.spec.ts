import type { Page } from "@playwright/test";
import { stableUuid } from "../../src/lib/hash";
import { expect, test } from "./fixtures";

// BC-42: the studio list: video cards with their newest version and state, filters for what
// needs Matthew, and a prompt box that starts a video (the fake runner runs its idea step).

const grid = (page: Page) => page.getByRole("list", { name: "Videos" });
const card = (page: Page, key: string) =>
  grid(page).locator(`[data-video="${stableUuid("factory-studio-list", "production", key)}"]`);

test("cards show each video's version and state; Needs me shows only what needs action", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-studio-list", { path: "/factory" });
  await expect(grid(page).getByRole("listitem")).toHaveCount(6);
  await expect(card(page, "tides").getByTestId("video-line")).toHaveText("v3, 3 answers to read");
  await expect(card(page, "ready").getByTestId("video-line")).toHaveText("Ready to post");
  await expect(card(page, "sched").getByTestId("video-line")).toContainText("Scheduled for");
  await expect(card(page, "posted").getByTestId("video-line")).toContainText("Posted");
  await expect(card(page, "wait").getByTestId("video-line")).toHaveText("Script waits for you");
  await expect(card(page, "render").getByTestId("video-line")).toHaveText("Render in progress");

  await page.getByRole("button", { name: /^Needs me/ }).click();
  await expect(grid(page).getByRole("listitem")).toHaveCount(3);
  for (const key of ["tides", "ready", "wait"]) await expect(card(page, key)).toBeVisible();
  await page.getByRole("button", { name: /^Scheduled/ }).click();
  await expect(grid(page).getByRole("listitem")).toHaveCount(1);
  await expect(card(page, "sched")).toBeVisible();
  await page.getByRole("button", { name: /^Posted/ }).click();
  await expect(card(page, "posted")).toBeVisible();
  await page.getByRole("button", { name: /^In progress/ }).click();
  await expect(grid(page).getByRole("listitem")).toHaveCount(1);
  await expect(card(page, "render")).toBeVisible();
});

test("the versions and ready scenarios show their version and state", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-versions", { path: "/factory" });
  await expect(grid(page).getByTestId("video-line")).toHaveText("v2");
  await loadScenario("factory-ready-to-post", { path: "/factory" });
  await expect(grid(page).getByTestId("video-line")).toHaveText("v3, 3 answers to read");
});

test("a prompt starts a video and opens it with the idea step done by the fake runner", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-new", { path: "/factory" });
  await page.getByLabel("What is the video about?").fill("A 60 s video about why the sea is salty");
  await page.getByLabel("Account").selectOption({ label: "@codingjourney" });
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/factory\/[0-9a-f-]{36}$/);
  await expect(page.locator('[data-step="idea"]')).toHaveAttribute("data-status", "waiting");
  await expect(
    page.getByRole("heading", { level: 1, name: "A 60 s video about why the sea is salty" }),
  ).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("the grid is one column with no sideways scroll", async ({ page, loadScenario }) => {
    await loadScenario("factory-studio-list", { path: "/factory" });
    await expect(grid(page).getByRole("listitem")).toHaveCount(6);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
