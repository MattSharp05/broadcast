"use client";

import { Check, TriangleExclamationPoint } from "lucide-react";
import { useEffect } from "react";
import styles from "./Toast.module.css";

interface ToastProps {
  /** null: nothing shown. */
  message: string | null;
  /** Change it to show the toast again (and restart its timer), even with the same words. */
  id?: number;
  onDone: () => void;
  /** How long it stays, in ms. */
  duration?: number;
  /** A button after the words (e.g. Undo); the toast closes when it's pressed. */
  action?: { label: string; onClick: () => void } | undefined;
  /** "error": a warning icon instead of the check, for a refused action. */
  tone?: "error" | undefined;
}

/**
 * The confirmation at the bottom centre (DESIGN.md → Components → Toasts): `--now` background, a
 * check icon and words that echo the action. Announced politely to screen readers.
 */
export function Toast({ message, id = 0, onDone, duration = 5000, action, tone }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDone, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [message, id, onDone, duration]);

  return (
    <div className={styles.region} role="status" aria-live="polite">
      {message ? (
        <div className={styles.toast} data-testid="toast" data-tone={tone} key={id}>
          {tone === "error" ? (
            <TriangleExclamationPoint aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
          <span>{message}</span>
          {action ? (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                action.onClick();
                onDone();
              }}
            >
              {action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
