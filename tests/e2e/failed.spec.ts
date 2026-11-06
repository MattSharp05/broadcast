import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/db/types";
import { stableUuid } from "../../src/lib/hash";
import { supabaseEnv } from "./env";
import { expect, test } from "./fixtures";

// BC-20: failed posts on the Sandbox (fake provider). A rejected video fails with the reason; the
// drawer lists the attempts and offers Retry now, Replace video and Remove; "1 failed" in the top
// bar pans to the failed card.

const VIDEO = (name: string) => join(process.cwd(), "tests/fixtures/video", name);
const SCENARIO = "publish-container-error";
const DUE = stableUuid(SCENARIO, "post", "due");
const card = (page: Page, postId = DUE) => page.locator(`[data-post="${postId}"]`);
const drawer = (page: Page) => page.getByRole("dialog");
const toast = (page: Page) => page.getByTestId("toast");
const stage = (page: Page) => page.locator("[data-canvas-stage]");

function admin() {
  const env = supabaseEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    {
      auth: { persistSession: false },
    },
  );
}

async function runTick(page: Page, runs: number, expected: string) {
  await page.getByRole("button", { name: "Run tick now" }).click();
  const result = page.getByTestId("tick-result");
  await expect(result).toHaveAttribute("data-runs", String(runs));
  await expect(result).toHaveText(expected);
}

async function openCanvas(page: Page) {
  await page.goto("/workflow");
  await expect(page.getByRole("region", { name: "Workflow canvas" })).toHaveAttribute(
    "data-ready",
    "true",
  );
}

async function open(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press("Enter");
  await expect(drawer(page)).toBeVisible();
}

/** publish-container-error after two ticks: uploaded, then failed with the reason. */
async function failIt(
  page: Page,
  loadScenario: (n: string, o?: { path?: string }) => Promise<void>,
) {
  await loadScenario(SCENARIO, { path: "/dev" });
  await runTick(page, 1, "Tick done: 1 uploaded.");
  await runTick(page, 2, "Tick done: 1 failed.");
  await openCanvas(page);
  await expect(card(page)).toHaveAttribute("data-kind", "failed");
}

test("a rejected video fails with the reason; Retry now publishes once the failure is cleared", async ({
  page,
  loadScenario,
}) => {
  await failIt(page, loadScenario);
  await expect(card(page)).toContainText("Failed");

  await open(page, card(page));
  const d = drawer(page);
  await expect(d).toContainText("Reels must be 9:16 (1080 × 1920)");
  const attempts = d.locator('[data-section="attempts"]');
  await expect(attempts).toContainText("Uploaded");
  await expect(attempts).toContainText("Failed, stopped");

  // The fake provider stops rejecting the account's videos.
  const { error } = await admin()
    .from("fake_accounts")
    .update({ failure_mode: null })
    .eq("account_id", stableUuid(SCENARIO, "account"));
  expect(error).toBeNull();

  await d.getByRole("button", { name: "Retry now" }).click();
  await expect(toast(page)).toHaveText("Retrying now. The scheduler tries again within a minute.");
  await expect(card(page)).not.toHaveAttribute("data-kind", "failed");

  await page.goto("/dev");
  await runTick(page, 1, "Tick done: 1 uploaded.");
  await runTick(page, 2, "Tick done: 1 published.");
  await openCanvas(page);
  await expect(card(page)).toHaveAttribute("data-kind", "posted");
});

test("Replace video: a 4:5 file is refused; a 9:16 one clears the failure and publishes", async ({
  page,
  loadScenario,
}) => {
  await failIt(page, loadScenario);
  await open(page, card(page));
  const d = drawer(page);
  const file = d.getByTestId("replace-video-file");

  await file.setInputFiles(VIDEO("portrait-4x5.mp4"));
  await expect(d.getByRole("alert")).toContainText("9:16");

  await file.setInputFiles(VIDEO("reel-9x16.mp4"));
  await expect(toast(page)).toHaveText("Video replaced. The scheduler posts it within a minute.");
  await expect(card(page)).not.toHaveAttribute("data-kind", "failed");

  await page.goto("/dev");
  await runTick(page, 1, "Tick done: 1 uploaded.");
  await runTick(page, 2, "Tick done: 1 published.");
  await openCanvas(page);
  await expect(card(page)).toHaveAttribute("data-kind", "posted");
});

test("Remove asks first, then takes the failed post off the canvas", async ({
  page,
  loadScenario,
}) => {
  await failIt(page, loadScenario);
  await open(page, card(page));
  await drawer(page).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(drawer(page).getByRole("group", { name: "Remove the failed post" })).toBeVisible();
  await drawer(page).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(toast(page)).toHaveText("Removed the failed post from @wrong.shape.");
  await expect(drawer(page)).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
});

test("clicking “1 failed” pans the canvas to the failed card", async ({ page, loadScenario }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 760, "The top bar stats are hidden on phones.");
  await failIt(page, loadScenario);

  // Pan away (wheel scrolls the canvas): far right and down.
  const s = await stage(page).boundingBox();
  if (!s) throw new Error("no stage");
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(1200, 900);

  const centre = async () => {
    const b = await card(page).boundingBox();
    if (!b) return null;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const inView = (c: { x: number; y: number } | null) =>
    !!c && c.x > s.x && c.x < s.x + s.width && c.y > s.y && c.y < s.y + s.height;
  expect(inView(await centre())).toBe(false);

  await page.getByRole("button", { name: "1 failed" }).click();
  // The pan animates: wait until the card sits at the stage's horizontal centre.
  await expect
    .poll(async () => {
      const c = await centre();
      return inView(c) && Math.abs((c?.x ?? 0) - (s.x + s.width / 2)) < 40;
    })
    .toBe(true);
});

test("post-failed: Retry now recovers a post whose answer was lost, without posting it again", async ({
  page,
  loadScenario,
}) => {
  const lost = stableUuid("post-failed", "post", "lost");
  await loadScenario("post-failed");
  await expect(page.getByRole("region", { name: "Workflow canvas" })).toHaveAttribute(
    "data-ready",
    "true",
  );
  await open(page, card(page, lost));
  const d = drawer(page);
  await expect(d.getByTestId("container-kept")).toBeVisible();
  await expect(d.getByRole("button", { name: "Replace video" })).toBeDisabled();
  await expect(d.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
  await expect(d.locator('[data-section="attempts"]')).toContainText("Error, retry in 4 min");

  await d.getByRole("button", { name: "Retry now" }).click();
  await expect(toast(page)).toHaveText("Retrying now. The scheduler tries again within a minute.");

  await page.goto("/dev");
  await runTick(page, 1, "Tick done: 1 published.");
  await openCanvas(page);
  await expect(card(page, lost)).toHaveAttribute("data-kind", "posted");
});
