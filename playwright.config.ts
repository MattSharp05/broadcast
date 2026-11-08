import { defineConfig, devices } from "@playwright/test";
import { E2E_EMAIL, E2E_TOKEN_ENC_KEY, supabaseEnv } from "./tests/e2e/env";

/**
 * e2e against a production build of the app and the local Supabase stack (`pnpm supabase start`).
 * - `pnpm e2e` builds and starts the app on :3100 (CI builds first and only starts it).
 * - A global set-up signs in through the e2e-only /auth/test-sign-in route and saves the session,
 *   so every test starts signed in as the owner.
 * - Tests share one Sandbox workspace (scenarios reset it), so they run one at a time.
 * Projects: `desktop` (Chromium) on every PR; `phone` (Pixel 7 layout) when UI changes and on main.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

const STORAGE_STATE = "tests/e2e/.auth/owner.json";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    storageState: STORAGE_STATE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: isCI ? `pnpm start -p ${PORT}` : `pnpm build && pnpm start -p ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !isCI,
    timeout: 240_000,
    env: {
      ...supabaseEnv(),
      E2E: "1",
      ALLOWED_EMAIL: E2E_EMAIL,
      TOKEN_ENC_KEY: E2E_TOKEN_ENC_KEY,
      // No Instagram app in e2e: Live connects fail with "not set up"; the Sandbox uses the fake.
      IG_APP_ID: "",
      IG_APP_SECRET: "",
      IG_LOGIN_CONFIG_ID: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
