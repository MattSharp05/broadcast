import { expect, test } from "./fixtures";

// BC-25…28: the Content Factory on the Sandbox. The fake runner plays every Claude session, and the
// generation proxy uses its fake provider: no session, no money.

const FACTORY = { path: "/factory" };

test("makes a free video from the idea to the queue", async ({ page, loadScenario }) => {
  await loadScenario("factory-new", FACTORY);
  await expect(page.getByRole("heading", { level: 1, name: "Content Factory" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No videos yet" })).toBeVisible();

  await page.getByRole("button", { name: "New video" }).first().click();
  await expect(page).toHaveURL(/\/factory\/[0-9a-f-]{36}$/);

  await page.getByLabel("Idea", { exact: true }).fill("How the moon causes tides");
  await page.getByRole("button", { name: "Save idea" }).click();
  await expect(page.getByRole("button", { name: "Save idea" })).toBeDisabled();

  // Style: five packs, four with an example frame from a past project.
  const styleCards = page.locator("[data-style]");
  await expect(styleCards).toHaveCount(5);
  await expect(page.locator("[data-style] img")).toHaveCount(4);
  await page.locator('[data-style="realistic-3d"]').click();
  await expect(page.locator('[data-style="realistic-3d"]')).toHaveAttribute(
    "data-selected",
    "true",
  );

  // Voice and music: scrollable lists with play buttons.
  const voices = page.getByTestId("voice-list");
  await expect(voices.getByRole("button", { name: /^Play American male/ })).toBeEnabled();
  await expect(
    voices.getByRole("button", { name: /No sample for American female/ }),
  ).toBeDisabled();
  await voices.locator('[data-voice="design-m2"]').click();
  const music = page.getByTestId("music-list");
  await expect(music).toContainText(
    'Music: "Floating Cities" by Kevin MacLeod (incompetech.com), CC BY 4.0',
  );
  await music.locator('[data-track="floating-cities"]').click();
  await expect(music.locator('[data-track="floating-cities"]')).toHaveAttribute(
    "data-selected",
    "true",
  );

  await page.getByRole("button", { name: "Start production" }).click();
  const idea = page.locator('[data-step="idea"]');
  await expect(idea).toHaveAttribute("data-status", "waiting");

  for (const step of ["idea", "script", "style", "visuals", "render"]) {
    const row = page.locator(`[data-step="${step}"]`);
    await expect(row).toHaveAttribute("data-status", "waiting");
    await row.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(row).toHaveAttribute("data-status", "approved");
  }
  await expect(page.getByTestId("recipe")).toContainText("realistic-3d");
  await expect(page.getByTestId("caption-options")).toContainText("CC BY 4.0");

  await page.getByRole("button", { name: "Add to queue" }).click();
  await expect(page.getByTestId("toast")).toContainText("Added to 1 queue");
  await expect(page.getByTestId("scheduled")).toContainText("@codingjourney");
  // The same video can't go to a second account: remake it instead.
  await expect(page.getByRole("button", { name: /^Remake for @maya.explains/ })).toBeVisible();

  // On the Workflow canvas like any post, with its recipe in the drawer.
  await page.getByRole("link", { name: "Open the Workflow" }).click();
  const canvas = page.getByRole("region", { name: "Workflow canvas" });
  await expect(canvas).toHaveAttribute("data-ready", "true");
  const card = page.locator('[data-column="codingjourney"] [data-kind="scheduled"]').first();
  await card.focus();
  await page.keyboard.press("Enter");
  const recipe = page.getByRole("dialog").locator('[data-section="recipe"]');
  await expect(recipe).toContainText("realistic-3d");
  await expect(recipe).toContainText("floating-cities");
});

test("lists every video and shows progress, waiting and failed steps", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-pipeline", FACTORY);
  const table = page.getByRole("table", { name: "Videos" });
  await expect(table.locator("tbody tr")).toHaveCount(5);
  await expect(table).toContainText("Waiting for you");
  await expect(table).toContainText("Ready to schedule");
  await expect(table).toContainText("Failed");

  await table.getByRole("link", { name: "How a git merge works" }).click();
  await expect(page.getByRole("progressbar", { name: "Render progress" })).toHaveAttribute(
    "aria-valuenow",
    "60",
  );

  await page.goto("/factory");
  await page.getByRole("link", { name: "Why ice floats" }).click();
  const failed = page.locator('[data-step="style"]');
  await expect(failed).toHaveAttribute("data-status", "failed");
  await expect(failed).toContainText("Remotion couldn't load the paper texture");
  await failed.getByRole("button", { name: /^Redo/ }).click();
  await expect(failed).toHaveAttribute("data-status", "waiting");
});

test("the avatar quote is paid: it shows the estimate first and spend after", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-avatar-quote", FACTORY);
  await page.getByRole("link", { name: "How tides work" }).click();
  const quote = page.locator('[data-step="face_quote"]');
  await expect(quote.getByTestId("face-quote")).toContainText("$1.05");
  await expect(quote).toContainText("Paid");
  await quote.getByRole("button", { name: "Approve and pay up to $1.05" }).click();
  await expect(quote).toHaveAttribute("data-status", "approved");
  await expect(page.getByTestId("gen-jobs").locator("li")).toHaveCount(3);
  await expect(page.locator("header")).toContainText("$0.84");
});

test("over the monthly cap the quote can't be approved", async ({ page, loadScenario }) => {
  await loadScenario("factory-over-cap", FACTORY);
  await page.getByRole("link", { name: "Why the sea is salty" }).click();
  const quote = page.locator('[data-step="face_quote"]');
  await expect(quote).toContainText("Autopilot paused");
  await quote.getByRole("button", { name: /^Approve and pay/ }).click();
  await expect(page.getByTestId("toast")).toContainText("monthly cap");
  await expect(quote).toHaveAttribute("data-status", "waiting");
});

test("reworking the voice keeps the paid avatar clips; a slot redo pays", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-rework", FACTORY);
  await page.getByRole("link", { name: "How rainbows form" }).click();
  await expect(page.locator("header")).toContainText("$0.84");
  await expect(page.locator("#rework")).toContainText("keeps the 3 paid avatar clips");

  await page.getByLabel("What to redo", { exact: true }).selectOption("voice");
  await page.getByRole("button", { name: "Redo voice" }).click();
  await expect(page.locator('[data-step="render"]')).toHaveAttribute("data-status", "waiting");
  await expect(page.locator("header")).toContainText("$0.84");
  await expect(page.getByTestId("gen-jobs").locator("li")).toHaveCount(3);

  await page.getByLabel("What to redo", { exact: true }).selectOption("avatar_slot");
  await page.getByLabel("Slot", { exact: true }).selectOption("hook");
  const redoSlot = page.getByRole("button", { name: /Redo this avatar slot, paid \$0\.28/ });
  await expect(redoSlot).toBeVisible();
  await redoSlot.click();
  await expect(page.getByTestId("gen-jobs").locator("li")).toHaveCount(4);
  await expect(page.locator("header")).toContainText("$1.12");
});

test("settings: a key is stored masked and tested, models and caps are saved", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("factory-new", { path: "/factory/settings" });
  const fal = page.locator('[data-provider="fal"]');
  await fal.getByLabel("fal.ai key").fill("fal-sandbox-secret-9876");
  await fal.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByTestId("masked-fal")).toHaveText("•••• 9876");
  // The key itself never comes back to the page.
  await expect(page.locator("body")).not.toContainText("fal-sandbox-secret");
  await fal.getByRole("button", { name: "Test key" }).click();
  await expect(fal).toContainText("Tested");

  const models = page.getByTestId("settings-models");
  await expect(models.locator('[data-model="hedra-character-3"] input')).toBeDisabled();
  await models.locator('[data-model="fal-kling-avatar-std"] input').check();
  await page.getByLabel("Default model", { exact: true }).selectOption("fal-kling-avatar-std");
  await page.getByRole("button", { name: "Save face models" }).click();
  await expect(page.getByTestId("toast")).toContainText("Face model settings saved");

  await page.getByLabel("Per video ($)").fill("3");
  await page.getByRole("button", { name: "Save caps" }).click();
  await expect(page.getByTestId("toast")).toContainText("$3.00 a video");
});

test("the avatar studio walks to v1, and a new voice makes v2", async ({ page, loadScenario }) => {
  await loadScenario("factory-new", { path: "/factory/avatars" });
  await expect(page.getByRole("table", { name: "Avatars" })).toContainText("Maya");
  await page.getByRole("link", { name: "New avatar" }).click();
  await page.getByLabel("Name").fill("Leo");
  await page.getByLabel("Account").selectOption({ label: "@codingjourney" });
  await page.getByRole("button", { name: "Open the studio" }).click();
  await expect(page).toHaveURL(/\/factory\/avatars\/[0-9a-f-]{36}$/);

  // 1. Persona drafts (free).
  await page.getByRole("button", { name: "Draft 3 personas" }).click();
  const persona = page.getByRole("radiogroup", { name: "Personas" }).getByRole("radio").first();
  await persona.click();
  await expect(persona).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  // 2. Portraits: paid, the estimate is on the button.
  await page.getByRole("button", { name: "Generate (paid, ~$0.32)" }).click();
  const portrait = page.getByRole("radiogroup", { name: "Portraits" }).getByRole("radio").nth(1);
  await portrait.click({ force: true });
  await expect(portrait).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  // 3. Face pack: approve four.
  await page.getByRole("button", { name: /^Generate \(paid/ }).click();
  for (const label of ["Frontal", "Three-quarter left", "Three-quarter right", "Smile"]) {
    await page.getByRole("button", { name: `Approve ${label}` }).click();
    await expect(page.getByTestId("face-pack")).toContainText(`${label}: approved`);
  }
  await page.getByRole("button", { name: "Continue" }).click();
  // 4. Voice: a blind pick.
  await page.getByRole("button", { name: "Load 3 voices" }).click();
  const voices = page.getByRole("radiogroup", { name: "Voices" });
  await expect(voices).toContainText("Voice A");
  await voices.getByRole("radio").first().click();
  await expect(voices.getByRole("radio").first()).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  // 5. Screen test, then v1.
  await page.getByRole("button", { name: /^Generate/ }).click();
  const test1 = page.getByRole("radiogroup", { name: "Screen tests" }).getByRole("radio").first();
  await test1.click();
  await expect(test1).toBeChecked();
  await page.getByRole("button", { name: "Approve and save as v1" }).click();
  await expect(page.getByTestId("avatar-versions")).toContainText("v1");

  await page.getByLabel("Avatar voice").selectOption("design-f2");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("toast")).toContainText("Saved as v2");
  await expect(page.getByTestId("avatar-versions")).toContainText("v2");
});
