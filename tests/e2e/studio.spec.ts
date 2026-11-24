import { stableUuid } from "../../src/lib/hash";
import { expect, test } from "./fixtures";

// BC-36: the studio scenarios (versions, a sent batch, an answered batch) on the Sandbox. The
// Versions tab (BC-37) adds the review flow on top of these.

const page = (name: string) => `/factory/${stableUuid(name, "production", "tides")}`;

for (const name of ["factory-versions", "factory-batch-sent", "factory-batch-answered"]) {
  test(`${name} opens the video`, async ({ page: p, loadScenario }) => {
    await loadScenario(name, { path: page(name) });
    await expect(
      p.getByRole("heading", { level: 1, name: "How the moon causes tides" }),
    ).toBeVisible();
  });
}
