import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicSupabaseEnv } from "./env";
import type { Database } from "./types";

/**
 * Service-role client: bypasses RLS. The only place the service-role key is used (CLAUDE.md →
 * Conventions). Server code only; never pass its results to the browser unfiltered.
 */
export function createAdminSupabase() {
  const { url } = publicSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (see .env.example).");
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
