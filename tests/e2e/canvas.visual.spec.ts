import { expect, test } from "./fixtures";

// BC-11 visual baselines: canvas-busy at 1440×900 in light and dark, at the mockup's
// "Now: Thu 5 Nov, 22:14". Baselines are generated on CI's runner (ubuntu-latest Chromium), never
// on a laptop: fonts and anti-aliasing differ between machines.
test.skip(({ viewport }) => viewport?.width !== 1440, "desktop baselines only");

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test(`canvas-busy matches the baseline @visual`, async ({ page, loadScenario }) => {
      // The performance line (added after these baselines) is hidden from the first paint, so the
      // canvas measures and places itself as before; performance.spec.ts checks the line.
      await page.addInitScript(() => {
        const style = document.createElement("style");
        style.textContent = '[data-testid="performance-line"] { display: none; }';
        document.documentElement.appendChild(style);
      });
      await loadScenario("canvas-busy");
      const stage = page.getByRole("region", { name: "Workflow canvas" });
      await expect(stage).toHaveAttribute("data-ready", "true");
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot(`canvas-busy-${colorScheme}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.01,
      });
    });
  });
}
