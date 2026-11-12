import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

export type Db = SupabaseClient<Database>;
export type TableName = keyof Database["public"]["Tables"];

export const ALLOWED_EMAIL = "allowed@broadcast.test";
export const OTHER_EMAIL = "someone-else@broadcast.test";
const PASSWORD = "integration-test-password";

/** Every table in the schema. `allTablesListed` below fails typecheck when a new table is missing. */
export const ALL_TABLES = [
  "account_metrics",
  "api_keys",
  "app_settings",
  "avatar_versions",
  "avatars",
  "brands",
  "content_uploads",
  "factory_music",
  "factory_settings",
  "factory_tokens",
  "factory_voices",
  "fake_accounts",
  "fake_containers",
  "gen_jobs",
  "gen_keys",
  "job_log",
  "media_assets",
  "oauth_credentials",
  "oauth_states",
  "post_metrics",
  "posts",
  "production_reworks",
  "production_steps",
  "productions",
  "scheduler_status",
  "settings",
  "social_accounts",
  "workspaces",
] as const satisfies readonly TableName[];

type Unlisted = Exclude<TableName, (typeof ALL_TABLES)[number]>;
export const allTablesListed: [Unlisted] extends [never] ? true : Unlisted = true;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (global-setup reads it from supabase status)`);
  return value;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export function adminClient(): Db {
  return createClient<Database>(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    noSession,
  );
}

export function anonClient(): Db {
  return createClient<Database>(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    noSession,
  );
}

/** Sets the email RLS allows (what the app does from ALLOWED_EMAIL on every sign-in request). */
export async function setAllowedEmail(email: string | null): Promise<void> {
  const { error } = await adminClient()
    .from("app_settings")
    .update({ allowed_email: email })
    .eq("id", true);
  if (error) throw error;
}

/** A client signed in as `email` (user created with a password; tests only). */
export async function signedInClient(email: string): Promise<Db> {
  const admin = adminClient();
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.error && created.error.code !== "email_exists") throw created.error;
  if (created.error) {
    // Exists from an earlier run, maybe without a password: set it.
    const id = await userIdByEmail(email);
    const updated = await admin.auth.admin.updateUserById(id, { password: PASSWORD });
    if (updated.error) throw updated.error;
  }

  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

export async function userIdByEmail(email: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`No user ${email}`);
  return user.id;
}

export async function deleteUser(email: string): Promise<void> {
  const { data } = await adminClient().auth.admin.listUsers({ perPage: 1000 });
  const user = data.users.find((u) => u.email === email);
  if (user) await adminClient().auth.admin.deleteUser(user.id);
}
