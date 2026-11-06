/**
 * How the connect flow tells the page that started it how it went (BC-9 sends, the Add account
 * wizard in BC-13 listens). Only ids and codes: never a token.
 *
 * - The done page posts a ConnectMessage to `window.opener` (same origin only) and on a
 *   BroadcastChannel named CONNECT_CHANNEL (works even when the provider's site cut the opener
 *   link), then closes itself if it is the wizard's popup.
 * - The wizard opens the popup with the window name CONNECT_WINDOW_NAME.
 */

export const CONNECT_MESSAGE_TYPE = "broadcast:connect";
export const CONNECT_CHANNEL = "broadcast-connect";
export const CONNECT_WINDOW_NAME = "broadcast-connect";

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
