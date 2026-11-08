/**
 * What a freshly connected account's status is, from the permissions the person granted on the
 * consent screen and the kind of account they connected. Pure (no I/O).
 */

export type ConnectPlatform = "instagram" | "fake";

export interface Permission {
  /** What the permission is for, in the user's words. */
  key: "profile" | "publishing" | "insights";
  /** Every scope the permission needs, per platform. */
  scopes: Record<ConnectPlatform, readonly string[]>;
  /** Shown as the account's status reason when the permission is missing. */
  missingMessage: string;
}

/**
 * In order of importance: the first missing one is the reason shown. Instagram's are the
 * "Instagram API with Facebook Login" permissions (ADR 0006): publishing and insights also need
 * pages_read_engagement on the Page the Instagram account is linked to.
 */
export const REQUIRED_PERMISSIONS: readonly Permission[] = [
  {
    key: "publishing",
    scopes: {
      instagram: ["instagram_content_publish", "pages_read_engagement"],
      fake: ["fake_content_publish"],
    },
    missingMessage: "Publishing permission wasn't granted. Reconnect and allow publishing.",
  },
  {
    key: "profile",
    scopes: { instagram: ["instagram_basic"], fake: ["fake_basic"] },
    missingMessage: "Profile access wasn't granted. Reconnect and allow access to the profile.",
  },
  {
    key: "insights",
    scopes: { instagram: ["instagram_manage_insights"], fake: ["fake_insights"] },
    missingMessage:
      "Insights permission wasn't granted, so stats can't be collected. Reconnect and allow insights.",
  },
];

/** Every scope Broadcast needs on a platform. */
export function requiredScopes(platform: ConnectPlatform): string[] {
  return [...new Set(REQUIRED_PERMISSIONS.flatMap((p) => p.scopes[platform]))];
}

/** True when every scope the permission needs on the platform was granted. */
export function hasPermission(
  permission: Permission,
  platform: ConnectPlatform,
  granted: ReadonlySet<string>,
): boolean {
  return permission.scopes[platform].every((s) => granted.has(s));
}

/** Instagram Login works only for professional accounts. */
const PROFESSIONAL_ACCOUNT_TYPES = new Set(["BUSINESS", "MEDIA_CREATOR", "CREATOR"]);

export const PERSONAL_ACCOUNT_MESSAGE =
  "This is a personal Instagram account. Switch it to a creator or business account in the Instagram app, then reconnect.";

export interface ConnectionStatus {
  status: "ready" | "needs_attention";
  /** Why it needs attention (null when ready). */
  reason: string | null;
}

export function connectionStatus(input: {
  platform: ConnectPlatform;
  grantedScopes: readonly string[];
  /** Instagram's account_type, when known. */
  accountType?: string | null;
}): ConnectionStatus {
  const granted = new Set(input.grantedScopes.map((s) => s.trim()).filter(Boolean));
  const missing = REQUIRED_PERMISSIONS.find((p) => !hasPermission(p, input.platform, granted));
  if (missing) return { status: "needs_attention", reason: missing.missingMessage };
  if (
    input.platform === "instagram" &&
    input.accountType &&
    !PROFESSIONAL_ACCOUNT_TYPES.has(input.accountType.toUpperCase())
  ) {
    return { status: "needs_attention", reason: PERSONAL_ACCOUNT_MESSAGE };
  }
  return { status: "ready", reason: null };
}

/** Why a connect attempt ended without an account; the done page shows the message. */
export const CONNECT_ERRORS = {
  denied: "Access wasn't allowed, so nothing was connected. Try again and choose Allow.",
  invalid_state:
    "This connection link isn't valid any more (it was already used, or opened in another browser). Start connecting again from Accounts.",
  expired: "Connecting took longer than 10 minutes. Start connecting again from Accounts.",
  brand: "That brand doesn't exist in this workspace. Pick a brand in Accounts and try again.",
  not_configured:
    "Instagram isn't set up on this server yet: IG_APP_ID, IG_APP_SECRET or IG_LOGIN_CONFIG_ID is missing. Add them in the Vercel project settings, or use a Sandbox account for now.",
  no_key:
    "Broadcast can't store Instagram access yet: TOKEN_ENC_KEY is missing on the server. Add it in the Vercel project settings (openssl rand -base64 32).",
  provider: "Instagram didn't accept the sign-in. Try connecting again.",
  rate_limited: "Instagram is limiting requests right now. Try connecting again in an hour.",
  cross_site:
    "Connecting has to start from Broadcast itself, not from a link on another site. Start connecting again from Accounts.",
  network: "Couldn't reach Instagram. Try again in a few minutes.",
  account:
    "That account isn't in this workspace any more. Open Accounts and pick the account to reconnect.",
  wrong_account:
    "The Instagram account you shared isn't the one you're reconnecting. Reconnect again and, in the Facebook window, choose that account.",
  no_instagram:
    "Facebook didn't share an Instagram account. Connect again and, in the Facebook window, choose your Instagram account. It must be a business or creator account linked to a Facebook Page you manage.",
  several_accounts:
    "You shared several Instagram accounts that aren't in Broadcast yet, so Broadcast can't tell which one to add. Connect again and, in the Facebook window, choose only the account you want to add.",
  failed:
    "Connecting failed on Broadcast's side. Try again; if it keeps failing, check the server logs.",
} as const;

export type ConnectErrorCode = keyof typeof CONNECT_ERRORS;

export function isConnectErrorCode(value: string | null | undefined): value is ConnectErrorCode {
  return typeof value === "string" && Object.hasOwn(CONNECT_ERRORS, value);
}

/**
 * Which shared Instagram account a connect attempt is for. One Facebook login can share several
 * accounts (they all come back on one token):
 * - Reconnect: the account being reconnected, which must be among them (else wrong_account).
 * - New: the only one shared, or else the only one not in the workspace yet. Anything else is
 *   ambiguous, and guessing could post a brand's videos to another brand's account.
 */
export function chooseAccount(input: {
  shared: readonly string[];
  /** The account being reconnected (its platform user id), if any. */
  reconnecting: string | null;
  /** Platform user ids already connected in the workspace. */
  connected: ReadonlySet<string>;
}): { platformUserId: string } | { error: "no_instagram" | "wrong_account" | "several_accounts" } {
  const shared = [...new Set(input.shared.filter(Boolean))];
  if (shared.length === 0) return { error: "no_instagram" };
  if (input.reconnecting) {
    return shared.includes(input.reconnecting)
      ? { platformUserId: input.reconnecting }
      : { error: "wrong_account" };
  }
  if (shared.length === 1) return { platformUserId: shared[0] ?? "" };
  const fresh = shared.filter((id) => !input.connected.has(id));
  return fresh.length === 1 ? { platformUserId: fresh[0] ?? "" } : { error: "several_accounts" };
}
