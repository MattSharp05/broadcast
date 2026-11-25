import { stableUuid } from "../../src/lib/hash";
import { expect, test } from "./fixtures";

// BC-39: the Ready to post tab on the Sandbox: a cover from a frame, hashtags, the checks and
// Mark ready. Nothing is scheduled or posted here.

const readyPage = (name: string) => `/factory/${stableUuid(name, "production", "tides")}`;

test("pick a cover, add hashtags, pass every check and mark the pack ready", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-ready-to-post", { path: readyPage("factory-ready-to-post") });
  await page.getByRole("tab", { name: "Ready to post" }).click();
  await expect(page.getByLabel("Version to post")).toHaveValue(
    stableUuid("factory-ready-to-post", "version", "3"),
  );
  const checks = page.getByTestId("checks");
  await expect(checks.locator('[data-check="cover"]')).toHaveAttribute("data-ok", "false");
  await expect(page.getByRole("button", { name: "Mark ready" })).toBeDisabled();

  // The sample video must have a frame to draw before it can be a cover.
  const video = page.getByTestId("cover").locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Forward one frame" }).click();
  await page.getByRole("button", { name: "Use this frame" }).click();
  await expect(page.getByTestId("cover-image")).toBeVisible();
  await expect(checks.locator('[data-check="cover"]')).toHaveAttribute("data-ok", "true");

  const tags = page.getByLabel(/Hashtags/);
  await tags.fill("#tides moon ");
  await tags.fill("science");
  await tags.press("Enter");
  await expect(page.getByTestId("hashtags")).toContainText("#tides");
  await expect(page.getByTestId("hashtags").getByRole("button", { name: /Remove #/ })).toHaveCount(
    3,
  );
  await expect(page.getByTestId("caption-count")).toContainText("with the hashtags");
  await page.getByRole("button", { name: "Save caption and hashtags" }).click();
  await expect(page.getByRole("button", { name: "Save caption and hashtags" })).toBeDisabled();

  await expect(checks.locator('[data-ok="false"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.getByTestId("ready")).toContainText("Ready since");

  await page.reload();
  await page.getByRole("tab", { name: "Ready to post" }).click();
  await expect(page.getByTestId("ready")).toContainText("Ready since");
  await expect(page.getByTestId("cover-image")).toBeVisible();
  await expect(page.getByTestId("hashtags").getByRole("button", { name: /Remove #/ })).toHaveCount(
    3,
  );
});

test("a 95 s version with a missing credit fails two checks and can't be marked ready", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-ready-failing", { path: readyPage("factory-ready-failing") });
  await page.getByRole("tab", { name: "Ready to post" }).click();
  const failing = page.getByTestId("checks").locator('[data-ok="false"]');
  await expect(failing).toHaveCount(2);
  await expect(page.getByTestId("checks").locator('[data-check="duration"]')).toContainText("90");
  await expect(page.getByTestId("checks").locator('[data-check="credits"]')).toContainText(
    "Floating Cities",
  );
  await expect(page.getByTestId("missing-credits")).toContainText("Floating Cities");
  await expect(page.getByRole("button", { name: "Mark ready" })).toBeDisabled();
});
