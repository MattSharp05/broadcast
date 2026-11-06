import { ProviderError } from "./types";

/**
 * True when a provider call failed because Broadcast's access to the account is gone: the token
 * expired or was revoked, or a permission was removed (every provider reports these as
 * `token_expired`). The account then needs reconnecting: it is flagged Needs attention and its
 * queued posts pause (src/lib/db/health.ts).
 */
export function isAuthError(err: unknown): err is ProviderError {
  return err instanceof ProviderError && err.code === "token_expired";
}

/** What the dashboard shows for a failed call. */
export function errorText(err: unknown): string {
  if (err instanceof ProviderError) return err.userMessage;
  return err instanceof Error ? err.message : String(err);
}
