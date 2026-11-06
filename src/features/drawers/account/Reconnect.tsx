"use client";

import { CircleAlert, LoaderCircle, RefreshCw, TriangleExclamationPoint } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { platformName } from "@/components/PlatformGlyph";
import { Toast } from "@/components/Toast";
import {
  CONNECT_CHANNEL,
  CONNECT_WINDOW_NAME,
  isConnectMessage,
  type ConnectMessage,
} from "@/features/accounts/connect-message";
import { CONNECT_ERRORS, isConnectErrorCode } from "@/lib/domain/connect";
import { connectionNote, type AccountDetail } from "@/lib/domain/details";
import { reconnectedMessage } from "@/lib/domain/health";
import styles from "../drawers.module.css";
import own from "./reconnect.module.css";

const POPUP_FEATURES = "popup,width=520,height=760";

type State =
  { kind: "idle" } | { kind: "waiting"; closed: boolean } | { kind: "error"; message: string };

/**
 * The account drawer's connection warning and its "Reconnect Instagram" button (BC-19). Runs the
 * connect flow (BC-9) for this account in a pop-up; the callback resumes its paused posts. When
 * the pop-up reports back, the page data is refreshed and a toast confirms it. Rendered for every
 * account so the toast outlives the warning it replaces.
 */
/**
 * Refreshes the page's server data each time `token` changes. Mounted only after a reconnect
 * reported back, so the drawer still renders where no app router is mounted (static tests).
 */
function Refresh({ token }: { token: number }) {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [token, router]);
  return null;
}

export function Reconnect({ account: a }: { account: AccountDetail }) {
  const [refreshes, setRefreshes] = useState(0);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const popup = useRef<Window | null>(null);

  const clearToast = useCallback(() => {
    setToast(null);
  }, []);

  const onMessage = useCallback(
    (msg: ConnectMessage) => {
      popup.current?.close();
      popup.current = null;
      if (!msg.accountId) {
        const code = isConnectErrorCode(msg.error) ? msg.error : "failed";
        setState({ kind: "error", message: CONNECT_ERRORS[code] });
        return;
      }
      setState({ kind: "idle" });
      if (msg.accountId === a.id && msg.status === "ready") {
        setToast((t) => ({
          id: (t?.id ?? 0) + 1,
          message: reconnectedMessage(a.handle, a.backlog > 0),
        }));
      }
      // The account (and its posts) changed on the server: show the new state.
      setRefreshes((n) => n + 1);
    },
    [a.id, a.handle, a.backlog],
  );

  const waiting = state.kind === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const onWindowMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !isConnectMessage(e.data)) return;
      if (popup.current && e.source !== popup.current) return;
      onMessage(e.data);
    };
    window.addEventListener("message", onWindowMessage);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CONNECT_CHANNEL);
      channel.onmessage = (e: MessageEvent) => {
        if (isConnectMessage(e.data)) onMessage(e.data);
      };
    } catch {
      // No BroadcastChannel: the opener message still arrives.
    }
    // A closed pop-up lets Reconnect be pressed again (keep listening: it may only look closed).
    const poll = window.setInterval(() => {
      if (popup.current?.closed)
        setState((s) => (s.kind === "waiting" ? { ...s, closed: true } : s));
    }, 700);
    return () => {
      window.removeEventListener("message", onWindowMessage);
      channel?.close();
      window.clearInterval(poll);
    };
  }, [waiting, onMessage]);

  useEffect(
    () => () => {
      popup.current?.close();
    },
    [],
  );

  const start = () => {
    const url = `/api/connect/instagram/start?account=${encodeURIComponent(a.id)}`;
    setState({ kind: "waiting", closed: false });
    popup.current?.close();
    const win = window.open(url, CONNECT_WINDOW_NAME, POPUP_FEATURES);
    if (win) {
      popup.current = win;
      win.focus();
      return;
    }
    // Pop-up blocked: reconnect in this tab; the done page comes back to Accounts.
    window.location.assign(url);
  };

  const busy = state.kind === "waiting" && !state.closed;
  const platform = platformName(a.platform);

  return (
    <>
      {a.status !== "ready" ? (
        <div className={own.reconnect} data-testid="reconnect">
          <div className={styles.note} data-tone="warn">
            <TriangleExclamationPoint aria-hidden="true" />
            <span>{connectionNote(a)}</span>
          </div>
          {state.kind === "error" ? (
            <div className={styles.note} data-tone="bad">
              <CircleAlert aria-hidden="true" />
              <span role="alert">{state.message}</span>
            </div>
          ) : null}
          <div className={styles.actions}>
            <Button variant="primary" onClick={start} disabled={busy}>
              {busy ? (
                <LoaderCircle aria-hidden="true" className={own.spin} />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              {busy
                ? `Waiting for ${platform}`
                : a.status === "not_connected"
                  ? `Connect ${platform}`
                  : `Reconnect ${platform}`}
            </Button>
            {state.kind === "waiting" ? (
              <Button
                variant="ghost"
                onClick={() => {
                  popup.current?.close();
                  popup.current = null;
                  setState({ kind: "idle" });
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
          {state.kind === "waiting" && state.closed ? (
            <span className={styles.help} role="status">
              The pop-up closed before reconnecting finished. Reconnect again to retry.
            </span>
          ) : null}
        </div>
      ) : null}
      {refreshes > 0 ? <Refresh token={refreshes} /> : null}
      <Toast message={toast?.message ?? null} id={toast?.id} onDone={clearToast} />
    </>
  );
}
