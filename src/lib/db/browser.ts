import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseEnv } from "./env";
import type { Database } from "./types";

/** Supabase client for Client Components: the signed-in user's session, limited by RLS. */
export function createBrowserSupabase() {
  const { url, anonKey } = publicSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
