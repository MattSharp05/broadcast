import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/db/types";
import { WORKSPACE_IDS } from "../../src/lib/db/workspaces";
import { stableUuid } from "../../src/lib/hash";
import { supabaseEnv } from "./env";
import { expect, test } from "./fixtures";

// BC-43: assign a ready version to its account and schedule it; the cover shows on the canvas and
// goes to the (fake) platform with the post. Sandbox only: the fake provider plays Instagram.

const videoPage = (name: string) => `/factory/${stableUuid(name, "production", "tides")}`;

function admin() {
  const env = supabaseEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

test("schedule a ready v3 for the account's next slot; the canvas card shows its cover", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-pack-ready", { path: videoPage("factory-pack-ready") });
  await page.getByRole("tab", { name: "Ready to post" }).click();
  await expect(page.getByTestId("ready")).toContainText("Ready since");

  const assign = page.locator("#assign");
  await expect(assign.getByLabel("Account")).toHaveValue(
    stableUuid("factory-pack-ready", "account", "cj"),
  );
  // Another account offers a remake, not a schedule.
  await assign
    .getByLabel("Account")
    .selectOption(stableUuid("factory-pack-ready", "account", "maya"));
  await expect(assign.getByRole("button", { name: "Remake for @maya.explains" })).toBeVisible();
  await assign
    .getByLabel("Account")
    .selectOption(stableUuid("factory-pack-ready", "account", "cj"));

  const schedule = assign.getByRole("button", { name: /^Schedule v3 for @codingjourney, / });
  await expect(schedule).toBeEnabled();
  const label = (await schedule.textContent()) ?? "";
  const when = label.replace(/^Schedule v3 for @codingjourney, /, "");
  await schedule.click();
  await expect(page.getByTestId("toast")).toHaveText(`v3 scheduled for @codingjourney, ${when}.`);
  await expect(assign.getByTestId("scheduled")).toContainText("@codingjourney");
  await page.getByRole("tab", { name: "Versions" }).click();
  await expect(page.getByTestId("activity")).toContainText("Scheduled v3 for @codingjourney");
  await page.getByRole("tab", { name: "Ready to post" }).click();

  await assign.getByRole("link", { name: "Open the Workflow" }).click();
  const canvas = page.getByRole("region", { name: "Workflow canvas" });
  await expect(canvas).toHaveAttribute("data-ready", "true");
  const card = page.locator('[data-column="codingjourney"] [data-kind="pinned"]').first();
  await expect(card.locator("img")).toHaveAttribute("src", "/factory/fake/still-2.svg");
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").locator("img").first()).toHaveAttribute(
    "src",
    "/factory/fake/still-2.svg",
  );
});

test("a tick at the slot uploads the post with its cover_url", async ({ page, loadScenario }) => {
  await loadScenario("factory-scheduled-cover");
  await page.goto("/dev");
  await page.getByRole("button", { name: "Run tick now" }).click();
  await expect(page.getByTestId("tick-result")).toHaveText("Tick done: 1 uploaded.");
  const containers = await admin()
    .from("fake_containers")
    .select("cover_url")
    .eq("workspace_id", WORKSPACE_IDS.sandbox);
  expect(containers.data).toEqual([
    expect.objectContaining({ cover_url: "/factory/fake/still-2.svg" }),
  ]);
});
