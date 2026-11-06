/**
 * How the connect flow tells the page that started it how it went (BC-9 sends, the Add account
 * wizard in BC-13 listens). Only ids and codes: never a token.
 *
 * - The done page posts a ConnectMessage to `window.opener` (same origin only) and on a
 *   BroadcastChannel named CONNECT_CHANNEL (works even when the provider's site cut the opener
 *   link), then closes itself if it is the wizard's popup.
 * - The wizard opens the popup with the window name CONNECT_WINDOW_NAME.
 * - When the popup is blocked, the wizard connects in its own tab instead: it saves where to come
 *   back to under CONNECT_RETURN_KEY (sessionStorage), and the done page stores its message under
 *   CONNECT_RESULT_KEY and goes back there, where the wizard picks it up at the Connect step.
 */

export const CONNECT_MESSAGE_TYPE = "broadcast:connect";
export const CONNECT_CHANNEL = "broadcast-connect";
export const CONNECT_WINDOW_NAME = "broadcast-connect";
/** sessionStorage: the same-site path the done page returns to (same-tab connect). */
export const CONNECT_RETURN_KEY = "broadcast:connect-return";
/** sessionStorage: the done page's ConnectMessage, for the page it returned to. */
export const CONNECT_RESULT_KEY = "broadcast:connect-result";

/** How long a same-tab connect's return path stays valid (the OAuth state's 10 minutes). */
export const CONNECT_RETURN_TTL_MS = 10 * 60_000;

/** A return path the done page may follow: same-site paths only (never `//host` or a URL). */
export function isReturnPath(value: unknown): value is string {
  return typeof value === "string" && /^\/(?![/\\])/.test(value);
}

/** What CONNECT_RETURN_KEY holds: the path, and until when it counts. */
export function encodeReturn(path: string, now: number): string {
  return JSON.stringify({ path, expires: now + CONNECT_RETURN_TTL_MS });
}

/**
 * The return path from CONNECT_RETURN_KEY, or null when it's missing, malformed or expired (a
 * same-tab connect abandoned earlier must not pull a later, unrelated one into the wizard).
 */
export function parseReturn(raw: string | null, now: number): string | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { path?: unknown; expires?: unknown };
    if (typeof data.expires !== "number" || data.expires <= now) return null;
    return isReturnPath(data.path) ? data.path : null;
  } catch {
    return null;
  }
}

export interface ConnectMessage {
  type: typeof CONNECT_MESSAGE_TYPE;
  /** The connected account, or null when connecting failed. */
  accountId: string | null;
  status: "ready" | "needs_attention" | "not_connected" | null;
  /** A CONNECT_ERRORS code when it failed. */
  error: string | null;
}

export function isConnectMessage(data: unknown): data is ConnectMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === CONNECT_MESSAGE_TYPE
  );
}
