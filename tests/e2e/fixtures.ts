import { expect, test as base, type Page } from "@playwright/test";

/** A fixed Sandbox clock for deterministic tests (the mockup's "Now: Thu 5 Nov, 22:14"). */
export const E2E_NOW = "2026-11-05T22:14:00Z";

export interface LoadScenarioOptions {
  /** Freeze the Sandbox clock (default E2E_NOW); null runs it on real time. */
  now?: string | null;
  /** The page to open (default /workflow). */
  path?: string;
}

export type LoadScenario = (name: string, options?: LoadScenarioOptions) => Promise<void>;

/**
 * Opens `<path>?scenario=<name>&now=…` like a QA link: the Sandbox is reset and seeded, and the
 * page loads in the Sandbox without the parameters.
 */
export async function loadScenario(page: Page, name: string, options: LoadScenarioOptions = {}) {
  const path = options.path ?? "/workflow";
  const now = options.now === undefined ? E2E_NOW : options.now;
  const query = new URLSearchParams({ scenario: name });
  if (now) query.set("now", now);
  await page.goto(`${path}?${query.toString()}`);
  await expect(page).toHaveURL((url) => url.pathname === path && !url.searchParams.has("scenario"));
}

/** `test` with a `loadScenario(name, options?)` fixture bound to the test's page. */
export const test = base.extend<{ loadScenario: LoadScenario }>({
  loadScenario: async ({ page }, provide) => {
    await provide((name, options) => loadScenario(page, name, options));
  },
});

export { expect };
