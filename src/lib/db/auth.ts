import "server-only";
import { isAllowedEmail, normalizeEmail } from "./access";
import { createAdminSupabase } from "./admin";
import { createServerSupabase } from "./server";

/** ALLOWED_EMAIL, normalised; "" when unset (then nobody can sign in). */
export function allowedEmail(): string {
  return normalizeEmail(process.env.ALLOWED_EMAIL);
}

/**
 * Prepares the database for the allowed user's sign-in (service role):
 * - writes ALLOWED_EMAIL into app_settings, which RLS reads, so the two never drift;
 * - creates the user if it doesn't exist yet. Public sign-up is off in Supabase Auth, so this is
 *   the only way an account comes into being.
 */
export async function ensureAllowedUser(email: string): Promise<void> {
  const admin = createAdminSupabase();

  const settings = await admin
    .from("app_settings")
    .upsert({ id: true, allowed_email: email }, { onConflict: "id" });
  if (settings.error) throw new Error(`Saving app_settings failed: ${settings.error.message}`);

  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error && created.error.code !== "email_exists") {
    throw new Error(`Creating the user failed: ${created.error.message}`);
  }
}

/**
 * True when the request comes from the signed-in allowed user. Route handlers under /api are
 * public in the middleware (they bring their own auth), so dashboard-only handlers check this.
 */
export async function isSignedInOwner(): Promise<boolean> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isAllowedEmail(user?.email, allowedEmail());
}
