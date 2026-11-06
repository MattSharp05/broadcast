import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// BC-13: the Add account wizard, end to end in the Sandbox (fake consent screen in a pop-up).

const wizard = (page: Page) => page.getByTestId("add-account-wizard");
const continueBtn = (page: Page) => wizard(page).getByRole("button", { name: "Continue" });
const currentStep = (page: Page) => wizard(page).locator('li[aria-current="step"]');

async function openWizard(page: Page) {
  await page.getByRole("button", { name: "Add account" }).first().click();
  await expect(wizard(page)).toBeVisible();
}

const CHECKS = [
  /Account created and email or phone verified/,
  /Switched to a professional/,
  /Tester invite/,
];

async function fillSignup(page: Page, username: string) {
  await wizard(page).getByLabel("Username").fill(username);
  for (const name of CHECKS) await wizard(page).getByRole("checkbox", { name }).check();
}

/** Clicks Connect, allows on the fake consent screen in the pop-up, waits for it to close. */
async function connectInPopup(
  page: Page,
  button: string,
  handle: string,
  options: { refuse?: string } = {},
) {
  const popupPromise = page.waitForEvent("popup");
  await wizard(page).getByRole("button", { name: button }).click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole("heading", { name: "Allow Broadcast to use this account?" }),
  ).toBeVisible();
  await popup.getByLabel("Instagram user").fill(handle);
  if (options.refuse) await popup.getByLabel(options.refuse).uncheck();
  await popup.getByRole("button", { name: "Allow" }).click();
  await popup.waitForEvent("close");
}

test("Sandbox: all five steps add an account to the table and the canvas", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("empty", { path: "/accounts" });
  await openWizard(page);
  await expect(wizard(page).getByRole("heading", { name: "Add an account" })).toBeVisible();

  // 1 Platform + brand.
  await expect(wizard(page).getByRole("button", { name: /Instagram/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(wizard(page).getByRole("button", { name: /TikTok/ })).toBeDisabled();
  await expect(wizard(page).getByRole("button", { name: /YouTube Shorts/ })).toBeDisabled();
  await expect(wizard(page).getByRole("combobox", { name: "Brand" })).toHaveValue(/.+/);
  await continueBtn(page).click();

  // 2 Create the account: Continue waits for the username and all three boxes.
  await expect(currentStep(page)).toContainText("Create the account");
  await expect(continueBtn(page)).toBeDisabled();
  await wizard(page).getByLabel("Username").fill("@kartracer.dev");
  for (const name of CHECKS) {
    await expect(continueBtn(page)).toBeDisabled();
    await wizard(page).getByRole("checkbox", { name }).check();
  }
  await expect(continueBtn(page)).toBeEnabled();
  await wizard(page).getByLabel("Username").fill("");
  await expect(continueBtn(page)).toBeDisabled();
  await wizard(page).getByLabel("Username").fill("kartracer.dev");
  await expect(wizard(page).getByRole("link", { name: "Open Instagram sign-up" })).toHaveAttribute(
    "target",
    "_blank",
  );
  await continueBtn(page).click();

  // 3 Save the login: a link only, never a password.
  await expect(currentStep(page)).toContainText("Save the login");
  await expect(wizard(page).getByRole("link", { name: "Open Bitwarden" })).toBeVisible();
  const vault = wizard(page).getByLabel("Link to the vault item (optional)");
  await vault.fill("javascript:alert(1)");
  await expect(continueBtn(page)).toBeDisabled();
  await vault.fill("https://vault.bitwarden.com/#/vault?itemId=e2e");
  await continueBtn(page).click();

  // 4 Connect in a pop-up (fake consent screen).
  await expect(currentStep(page)).toContainText("Connect");
  await expect(continueBtn(page)).toBeDisabled();
  await connectInPopup(page, "Connect (Sandbox)", "kartracer.dev");
  const result = wizard(page).getByTestId("connect-result");
  await expect(wizard(page)).toContainText("@kartracer.dev is connected and ready to publish.");
  for (const key of ["profile", "publishing", "insights"]) {
    await expect(result.locator(`[data-permission="${key}"]`)).toContainText("Granted");
  }
  await expect(result).toContainText("Daily posts used0 of 100");
  await expect(continueBtn(page)).toBeEnabled();
  await continueBtn(page).click();

  // 5 Set up posting.
  await expect(currentStep(page)).toContainText("Set up posting");
  const tag = wizard(page).getByRole("combobox", { name: "Add a tag" });
  await tag.fill("Racing");
  await tag.press("Enter");
  await wizard(page).getByLabel("Description").fill("Kart racing clips for the game's launch.");
  await wizard(page).getByRole("button", { name: "Remove slot 18:00" }).click();
  await wizard(page).getByLabel("New slot time").fill("12:30");
  await wizard(page).getByRole("button", { name: "Add slot" }).click();
  await wizard(page).getByLabel("New slot time").fill("20:00");
  await wizard(page).getByRole("button", { name: "Add slot" }).click();
  await expect(wizard(page).locator("[data-slot]")).toHaveText(["09:00", "12:30", "20:00"]);

  // No password field anywhere in the wizard.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  await wizard(page).getByRole("button", { name: "Add account" }).click();
  await expect(wizard(page)).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "added" })).toHaveText(
    "@kartracer.dev added with 3 open slots a day.",
  );

  const row = page.locator('tr[data-account="kartracer.dev"]');
  await expect(row).toContainText("Ready");
  await expect(row).toContainText("Racing");
  await expect(row.getByLabel("Description for @kartracer.dev")).toHaveValue(
    "Kart racing clips for the game's launch.",
  );
  await expect(row.locator("td").nth(5)).toHaveText("3");

  // A new canvas column with its slots as open-slot cards (now: Thu 5 Nov, 22:14).
  await page.goto("/workflow");
  const column = page.locator('[data-column="kartracer.dev"]');
  await expect(column).toBeAttached();
  await expect(column.locator('[data-kind="open"]').first()).toContainText("Tomorrow, 09:00");
  await expect(column.locator('[data-kind="open"]')).toHaveCount(4);

  // The draft is gone: the next wizard starts fresh.
  await page.goto("/accounts");
  await openWizard(page);
  await expect(currentStep(page)).toContainText("Platform");
});

test("Sandbox: a missing permission shows which one and a Reconnect; Continue waits", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("empty", { path: "/accounts" });
  await openWizard(page);
  await continueBtn(page).click();
  await fillSignup(page, "half.allowed");
  await continueBtn(page).click();
  await continueBtn(page).click();

  await connectInPopup(page, "Connect (Sandbox)", "half.allowed", { refuse: "Publish Reels" });
  const result = wizard(page).getByTestId("connect-result");
  await expect(wizard(page).getByRole("alert")).toContainText(
    "Publishing permission wasn't granted. Reconnect and allow publishing.",
  );
  await expect(result.locator('[data-permission="publishing"]')).toContainText("Missing");
  await expect(result.locator('[data-permission="profile"]')).toContainText("Granted");
  await expect(continueBtn(page)).toBeDisabled();

  await connectInPopup(page, "Reconnect", "half.allowed");
  await expect(result.locator('[data-permission="publishing"]')).toContainText("Granted");
  await expect(continueBtn(page)).toBeEnabled();
});

test("closing keeps the draft; Back keeps entered values; a new brand is created", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("no-accounts", { path: "/accounts" });
  await openWizard(page);

  // No brands yet: a new one, named.
  await expect(wizard(page).getByRole("combobox", { name: "Brand" })).toHaveValue("new");
  await expect(continueBtn(page)).toBeDisabled();
  await wizard(page).getByLabel("New brand name").fill("Kart Racer");
  await continueBtn(page).click();
  await expect(currentStep(page)).toContainText("Create the account");

  await wizard(page).getByLabel("Username").fill("kartracer.dev");
  await wizard(page).getByRole("checkbox", { name: CHECKS[0] }).check();
  await wizard(page).getByRole("button", { name: "Close" }).click();
  await expect(wizard(page)).toBeHidden();
  await expect(page.locator('tr[data-brand="Kart Racer"]')).toBeVisible();

  await openWizard(page);
  await expect(currentStep(page)).toContainText("Create the account");
  await expect(wizard(page).getByLabel("Username")).toHaveValue("kartracer.dev");
  await expect(wizard(page).getByRole("checkbox", { name: CHECKS[0] })).toBeChecked();

  await wizard(page).getByRole("button", { name: "Back" }).click();
  await expect(wizard(page).getByRole("combobox", { name: "Brand" })).toHaveValue(
    /^[0-9a-f-]{36}$/,
  );
  await expect(
    wizard(page).getByRole("combobox", { name: "Brand" }).locator("option:checked"),
  ).toHaveText("Kart Racer");
  await continueBtn(page).click();
  await expect(wizard(page).getByLabel("Username")).toHaveValue("kartracer.dev");

  // Escape closes too, and a reload still has the draft (same tab).
  await page.keyboard.press("Escape");
  await expect(wizard(page)).toBeHidden();
  await page.reload();
  await openWizard(page);
  await expect(wizard(page).getByLabel("Username")).toHaveValue("kartracer.dev");
});

test("pop-up blocked: connects in the same tab and comes back to the wizard at Connect", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("empty", { path: "/accounts" });
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.reload();
  await openWizard(page);
  await continueBtn(page).click();
  await fillSignup(page, "same.tab");
  await continueBtn(page).click();
  await continueBtn(page).click();

  await wizard(page).getByRole("button", { name: "Connect (Sandbox)" }).click();
  await expect(page).toHaveURL(/\/connect\/fake\?state=/);
  await page.getByLabel("Instagram user").fill("same.tab");
  await page.getByRole("button", { name: "Allow" }).click();

  await expect(page).toHaveURL(/\/accounts$/);
  await expect(wizard(page)).toBeVisible();
  await expect(currentStep(page)).toContainText("Connect");
  await expect(wizard(page)).toContainText("@same.tab is connected and ready to publish.");
  await expect(continueBtn(page)).toBeEnabled();
});
