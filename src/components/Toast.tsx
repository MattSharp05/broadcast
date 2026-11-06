"use client";

import { Check } from "lucide-react";
import { useEffect } from "react";
import styles from "./Toast.module.css";

interface ToastProps {
  /** null: nothing shown. A new message restarts the timer. */
  message: string | null;
  onDone: () => void;
  /** How long it stays, in ms. */
  duration?: number;
}

/**
 * The confirmation at the bottom centre (DESIGN.md → Components → Toasts): `--now` background, a
 * check icon and words that echo the action. Announced politely to screen readers.
 */
export function Toast({ message, onDone, duration = 5000 }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDone, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [message, onDone, duration]);

  return (
    <div className={styles.region} role="status" aria-live="polite">
      {message ? (
        <div className={styles.toast} data-testid="toast" key={message}>
          <Check aria-hidden="true" />
          <span>{message}</span>
        </div>
      ) : null}
    </div>
  );
}
