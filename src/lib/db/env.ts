/**
 * Supabase settings from the environment. The two NEXT_PUBLIC_ values are inlined into the
 * browser bundle by Next.js, so they must be read with literal `process.env.NEXT_PUBLIC_…`.
 */
export interface PublicSupabaseEnv {
  url: string;
  anonKey: string;
}

/** The public URL + anon key, or null when they aren't configured. */
export function readPublicSupabaseEnv(): PublicSupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function publicSupabaseEnv(): PublicSupabaseEnv {
  const env = readPublicSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).",
    );
  }
  return env;
}
