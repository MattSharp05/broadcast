import type { SupabaseClient } from "@supabase/supabase-js";
import { credentialContext, decryptToken } from "@/lib/crypto/tokens";

export { TokenDecryptError } from "@/lib/crypto/tokens";
import type { Database } from "./types";

/**
 * An account's decrypted access token (ADR 0004), for the scheduler's provider calls. Needs the
 * service-role client (oauth_credentials has no browser access). Null when the account has no
 * stored token (it needs reconnecting). Throws TokenDecryptError when the stored token can't be
 * decrypted: most likely TOKEN_ENC_KEY changed, a server problem rather than the account's.
 */
export async function loadAccessToken(
  admin: SupabaseClient<Database>,
  workspaceId: string,
  accountId: string,
  key: Buffer,
): Promise<string | null> {
  const { data, error } = await admin
    .from("oauth_credentials")
    .select("access_token_enc")
    .eq("workspace_id", workspaceId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(`Reading the account's token failed: ${error.message}`);
  if (!data) return null;
  return decryptToken(data.access_token_enc, key, credentialContext(accountId));
}
