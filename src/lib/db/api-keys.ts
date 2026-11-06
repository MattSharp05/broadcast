import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  apiKeyKind,
  bearerToken,
  generateApiKey,
  hashApiKey,
  isApiKeyShape,
  sameHash,
} from "@/lib/auth/api-keys";
import type { Database } from "./types";
import { WORKSPACE_IDS, workspaceKindOf, type WorkspaceKind } from "./workspaces";

type Db = SupabaseClient<Database>;

/**
 * API keys in the database (BC-17). Service-role client only: browser roles can't read or write
 * `key_hash`. The key itself is never stored or logged.
 */

export interface ApiKeyAuth {
  keyId: string;
  workspaceId: string;
  kind: WorkspaceKind;
}

/** Makes a key for a workspace. Returns the key: the only time it exists outside the client. */
export async function createApiKey(
  admin: Db,
  input: { kind: WorkspaceKind; name: string },
): Promise<{ id: string; key: string }> {
  const key = generateApiKey(input.kind);
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      workspace_id: WORKSPACE_IDS[input.kind],
      name: input.name,
      key_hash: hashApiKey(key),
    })
    .select("id")
    .single();
  if (error) throw new Error(`Creating the API key failed: ${error.message}`);
  return { id: data.id, key };
}

/**
 * The key an `Authorization: Bearer` header carries, if it is one of ours and not revoked. Read on
 * every request, so a revoked key stops working at once. Sets `last_used_at` (best effort).
 */
export async function authenticateApiKey(
  admin: Db,
  authorization: string | null,
): Promise<ApiKeyAuth | null> {
  const key = bearerToken(authorization);
  if (!key || !isApiKeyShape(key)) return null;
  const hash = hashApiKey(key);
  const { data, error } = await admin
    .from("api_keys")
    .select("id, workspace_id, key_hash, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (error) throw new Error(`Reading the API key failed: ${error.message}`);
  if (data?.revoked_at !== null || !sameHash(data.key_hash, hash)) return null;
  let kind: WorkspaceKind;
  try {
    kind = workspaceKindOf(data.workspace_id);
  } catch {
    return null;
  }
  // The prefix says which workspace the key is for; a mismatch means something is off.
  if (apiKeyKind(key) !== kind) return null;

  const touched = await admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  if (touched.error) console.error(`Recording the API key's use failed: ${touched.error.message}`);
  return { keyId: data.id, workspaceId: data.workspace_id, kind };
}
