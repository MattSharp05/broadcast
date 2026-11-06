import { execFileSync } from "node:child_process";

/** The email the e2e run signs in as (ALLOWED_EMAIL of the app under test). */
export const E2E_EMAIL = process.env.ALLOWED_EMAIL ?? "e2e-owner@broadcast.test";

/**
 * Supabase URL and keys for the app under test: from the environment (CI exports them), else from
 * the local stack's `supabase status`.
 */
export function supabaseEnv(): Record<string, string> {
  const fromEnv = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (Object.values(fromEnv).every(Boolean)) return fromEnv as Record<string, string>;

  let out: string;
  try {
    out = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("Local Supabase isn't running. Start it with `pnpm supabase start`.");
  }
  const status = JSON.parse(out.slice(out.indexOf("{"))) as Record<string, string | undefined>;
  return {
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY ?? "",
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY ?? "",
  };
}
