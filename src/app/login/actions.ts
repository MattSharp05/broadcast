"use server";

import { headers } from "next/headers";
import { isAllowedEmail, normalizeEmail, safeNextPath } from "@/lib/db/access";
import { allowedEmail, ensureAllowedUser } from "@/lib/db/auth";
import { readPublicSupabaseEnv } from "@/lib/db/env";
import { createServerSupabase } from "@/lib/db/server";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "private"; email: string }
  | { status: "error"; message: string; email: string };

/** Sends a magic link to ALLOWED_EMAIL. Any other address gets "This dashboard is private." */
export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = formData.get("email");
  const email = normalizeEmail(typeof raw === "string" ? raw : "");
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    return { status: "error", message: "Enter your email address.", email };
  }
  if (!isAllowedEmail(email, allowedEmail())) return { status: "private", email };
  if (!readPublicSupabaseEnv()) {
    return {
      status: "error",
      message: "Sign-in isn't set up yet: Supabase settings are missing.",
      email,
    };
  }

  const nextRaw = formData.get("next");
  const next = safeNextPath(typeof nextRaw === "string" ? nextRaw : null);

  try {
    await ensureAllowedUser(email);
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${await appOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) throw error;
  } catch (error) {
    console.error("Magic link request failed", error);
    return { status: "error", message: "Couldn't send the link. Try again in a minute.", email };
  }

  return { status: "sent", email };
}

/**
 * Where the magic link points: APP_URL, else Vercel's production domain. Only local and CI runs
 * (neither set) fall back to the request's own origin.
 */
async function appOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
