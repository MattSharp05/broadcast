"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CONNECT_CHANNEL,
  CONNECT_MESSAGE_TYPE,
  CONNECT_WINDOW_NAME,
  type ConnectMessage,
} from "@/features/accounts/connect-message";
import styles from "../connect.module.css";

/** How long a successful result stays on screen before going back to Accounts. */
const RETURN_AFTER_MS = 2500;

/**
 * Tells the page that started connecting how it went (opener + BroadcastChannel, same origin
 * only), closes the wizard's popup, or, opened directly, goes back to Accounts after a ready
 * result. A result that needs reading (an error, a missing permission) stays on screen.
 */
export function ConnectDone({ accountId, status, error }: Omit<ConnectMessage, "type">) {
  const router = useRouter();
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    const message: ConnectMessage = { type: CONNECT_MESSAGE_TYPE, accountId, status, error };
    const origin = window.location.origin;
    try {
      const channel = new BroadcastChannel(CONNECT_CHANNEL);
      channel.postMessage(message);
      channel.close();
    } catch {
      // No BroadcastChannel (old browser): the opener message below still works.
    }
    const opener = window.opener as Window | null;
    if (opener && opener !== window) {
      try {
        opener.postMessage(message, origin);
      } catch {
        // The opener is on another site: nothing to tell.
      }
    }
    if ((opener && opener !== window) || window.name === CONNECT_WINDOW_NAME) {
      window.close();
      return;
    }
    if (status !== "ready") return;
    setReturning(true);
    const timer = window.setTimeout(() => {
      router.replace("/accounts");
    }, RETURN_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [accountId, status, error, router]);

  return returning ? (
    <p className={styles.text} role="status">
      Taking you to Accounts…
    </p>
  ) : null;
}
