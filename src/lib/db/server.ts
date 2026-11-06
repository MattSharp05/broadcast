import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabaseEnv } from "./env";
import type { Database } from "./types";

/**
 * Supabase client for Server Components, server actions and route handlers. Acts as the signed-in
 * user (session from cookies), so RLS applies.
 */
export async function createServerSupabase() {
  const { url, anonKey } = publicSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The middleware refreshes
          // the session cookies instead.
        }
      },
    },
  });
}
