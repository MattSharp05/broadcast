import { hasTokenKey, tokenKeyFromEnv } from "@/lib/crypto/tokens";
import { loadAccessToken } from "@/lib/db/credentials";
import { ProviderError, type ProviderAccount, type ProviderPlatform } from "@/lib/providers";
import type { Db } from "./types";

/**
 * The provider account for a scheduler call, shared by the steps (publish, stats, refresh): the
 * decrypted token for Instagram, read once per account per tick; none for the fake provider.
 * Throws MISSING_TOKEN (an auth error: the account needs reconnecting) when no token is stored or
 * the deployment has no TOKEN_ENC_KEY, and TokenDecryptError when the stored one can't be opened.
 */

export interface TokenAccount {
  id: string;
  workspaceId: string;
  platform: ProviderPlatform;
  platformUserId: string | null;
}

export const MISSING_TOKEN = new ProviderError({
  code: "token_expired",
  retryable: false,
  userMessage:
    "Broadcast has no working Instagram access for this account. Reconnect it to resume posting.",
});

/** TOKEN_ENC_KEY from the deps when given (null: none), else from the environment. */
export function resolveTokenKey(fromDeps: Buffer | null | undefined): Buffer | null {
  if (fromDeps !== undefined) return fromDeps;
  return hasTokenKey() ? tokenKeyFromEnv() : null;
}

export function createTokenReader(db: Db, tokenKey: Buffer | null) {
  const tokens = new Map<string, Promise<string | null>>();
  return async (account: TokenAccount): Promise<ProviderAccount> => {
    const base = { accountId: account.id, platformUserId: account.platformUserId };
    if (account.platform === "fake") return { ...base, accessToken: "" };
    let token = tokens.get(account.id);
    if (!token) {
      token = tokenKey
        ? loadAccessToken(db, account.workspaceId, account.id, tokenKey)
        : Promise.resolve(null);
      tokens.set(account.id, token);
    }
    const accessToken = await token;
    if (!accessToken) throw MISSING_TOKEN;
    return { ...base, accessToken };
  };
}
