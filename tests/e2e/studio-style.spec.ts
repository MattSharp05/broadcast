import { stableUuid } from "../../src/lib/hash";
import { expect, test } from "./fixtures";

// BC-41: comparing styles on the Sandbox. The fake runner shows the hook beat in three styles,
// one recommended; Use this style picks it, Use this, but … redoes that style with a note.

const videoPage = `/factory/${stableUuid("factory-style-compare", "production", "tides")}`;

test("three frames, one recommended; Use this style saves it and approves the step", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-style-compare", { path: videoPage });
  const compare = page.getByTestId("style-compare");
  await expect(compare.locator("[data-style-frame]")).toHaveCount(3);
  await expect(compare.getByTestId("recommended")).toHaveCount(1);
  // Approving without a pick isn't possible.
  const styleStep = page.locator('[data-step="style"]');
  await styleStep.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByTestId("toast")).toContainText("Pick one of the styles first");

  await compare
    .locator('[data-style-frame="luminous-3d"]')
    .getByRole("button", { name: "Use this style" })
    .click();
  await expect(styleStep).toHaveAttribute("data-status", "approved");
  await expect(page.locator('[data-style="luminous-3d"]')).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("style-compare")).toHaveCount(0);
});

test("Use this, but warmer reruns the style step for that style with the note", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-style-compare", { path: videoPage });
  const frame = page.getByTestId("style-compare").locator('[data-style-frame="motion-graphics"]');
  await frame.getByRole("button", { name: "Use this, but …" }).click();
  await frame.getByLabel("What to change in Motion graphics").fill("warmer");
  await frame.getByRole("button", { name: "Redo in Motion graphics" }).click();
  const styleStep = page.locator('[data-step="style"]');
  // The fake runner redoes it at once: one frame, in the chosen style, waiting again.
  await expect(styleStep).toHaveAttribute("data-status", "waiting");
  await expect(page.getByTestId("style-compare")).toHaveCount(0);
  await expect(page.locator('[data-style="motion-graphics"]')).toHaveAttribute(
    "data-selected",
    "true",
  );
});

test("a new video compares styles by default; ticking candidates limits them to three", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-new", { path: "/factory" });
  await page.getByRole("button", { name: "New video" }).first().click();
  await expect(page.getByLabel(/Compare styles/)).toBeChecked();
  const candidates = page.getByTestId("style-candidates");
  for (const label of ["Editorial collage", "Handmade 2D", "Luminous 3D"]) {
    await candidates.getByLabel(label).click();
    await expect(candidates.getByLabel(label)).toBeChecked();
  }
  await expect(candidates.getByLabel("Realistic 3D")).toBeDisabled();
});
