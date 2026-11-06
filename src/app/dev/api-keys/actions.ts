"use server";

import { revalidatePath } from "next/cache";
import { apiKeyName } from "@/lib/auth/api-keys";
import { createAdminSupabase } from "@/lib/db/admin";
import { createApiKey } from "@/lib/db/api-keys";
import { isSignedInOwner } from "@/lib/db/auth";
import { createServerSupabase } from "@/lib/db/server";
import { WORKSPACE_NAMES, parseWorkspaceKind } from "@/lib/db/workspaces";

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export interface CreateKeyState {
  /** The new key: shown once, never stored. */
  key: string | null;
  name: string;
  workspace: string;
  error: string | null;
  /** Increments per submit, so the same result twice still reads as new. */
  runs: number;
}

/** "Create key" on /dev/api-keys (signed-in owner). The hash is stored; the key goes back once. */
export async function createKeyAction(
  prev: CreateKeyState,
  form: FormData,
): Promise<CreateKeyState> {
  const runs = prev.runs + 1;
  const base = { key: null, name: "", workspace: "", runs };
  if (!(await isSignedInOwner())) return { ...base, error: "Sign in to create keys." };
  const name = apiKeyName(form.get("name"));
  if (!name) return { ...base, error: "Name the key (1 to 60 characters), e.g. video-editor." };
  const kind = parseWorkspaceKind(formText(form, "workspace"));
  try {
    const { key } = await createApiKey(createAdminSupabase(), { kind, name });
    revalidatePath("/dev/api-keys");
    return { key, name, workspace: WORKSPACE_NAMES[kind], error: null, runs };
  } catch (err) {
    console.error(err);
    return { ...base, error: "Couldn't create the key. Try again in a moment." };
  }
}

/** "Revoke" (signed-in owner, through RLS). The key stops working on its next request. */
export async function revokeKeyAction(form: FormData): Promise<void> {
  const id = formText(form, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await isSignedInOwner())) return;
  const db = await createServerSupabase();
  const { error } = await db
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);
  if (error) console.error(`Revoking the API key failed: ${error.message}`);
  revalidatePath("/dev/api-keys");
}
