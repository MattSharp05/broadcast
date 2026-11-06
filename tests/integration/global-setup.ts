import { execFileSync } from "node:child_process";

/**
 * Points the tests at the local Supabase stack. Reads URL and keys from `supabase status` unless
 * they are already in the environment.
 */
export default function setup() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
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
    process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
    process.env.MAILPIT_URL ??= status.MAILPIT_URL ?? status.INBUCKET_URL;
  }
  process.env.MAILPIT_URL ??= "http://127.0.0.1:54324";
}
