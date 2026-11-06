/**
 * What a freshly connected account's status is, from the permissions the person granted on the
 * consent screen and the kind of account they connected. Pure (no I/O).
 */

export type ConnectPlatform = "instagram" | "fake";

export interface Permission {
  /** What the permission is for, in the user's words. */
  key: "profile" | "publishing" | "insights";
  scopes: Record<ConnectPlatform, string>;
  /** Shown as the account's status reason when the permission is missing. */
  missingMessage: string;
}

/** In order of importance: the first missing one is the reason shown. */
export const REQUIRED_PERMISSIONS: readonly Permission[] = [
  {
    key: "publishing",
    scopes: { instagram: "instagram_business_content_publish", fake: "fake_content_publish" },
    missingMessage: "Publishing permission wasn't granted. Reconnect and allow publishing.",
  },
  {
    key: "profile",
    scopes: { instagram: "instagram_business_basic", fake: "fake_basic" },
    missingMessage: "Profile access wasn't granted. Reconnect and allow access to the profile.",
  },
  {
    key: "insights",
    scopes: { instagram: "instagram_business_manage_insights", fake: "fake_insights" },
    missingMessage:
      "Insights permission wasn't granted, so stats can't be collected. Reconnect and allow insights.",
  },
];

/** Every scope Broadcast asks for on a platform. */
export function requiredScopes(platform: ConnectPlatform): string[] {
  return REQUIRED_PERMISSIONS.map((p) => p.scopes[platform]);
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
  const missing = REQUIRED_PERMISSIONS.find((p) => !granted.has(p.scopes[input.platform]));
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
    "Instagram isn't set up on this server yet: IG_APP_ID and IG_APP_SECRET are missing. Add them in the Vercel project settings, or use a Sandbox account for now.",
  no_key:
    "Broadcast can't store Instagram access yet: TOKEN_ENC_KEY is missing on the server. Add it in the Vercel project settings (openssl rand -base64 32).",
  provider: "Instagram didn't accept the sign-in. Try connecting again.",
  network: "Couldn't reach Instagram. Try again in a few minutes.",
  failed:
    "Connecting failed on Broadcast's side. Try again; if it keeps failing, check the server logs.",
} as const;

export type ConnectErrorCode = keyof typeof CONNECT_ERRORS;

export function isConnectErrorCode(value: string | null | undefined): value is ConnectErrorCode {
  return typeof value === "string" && Object.hasOwn(CONNECT_ERRORS, value);
}
