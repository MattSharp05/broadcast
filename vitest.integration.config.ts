import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Integration tests against the local Supabase stack (`pnpm supabase start`), incl. RLS.
 * Run with `pnpm test:integration`; kept apart from the fast unit suite (`pnpm test`).
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // `server-only` throws outside React Server Components; tests import server modules directly.
    alias: { "server-only": fileURLToPath(new URL("tests/integration/empty.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    // One database: run files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
