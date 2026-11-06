"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./Modal.module.css";

interface ModalProps {
  open: boolean;
  /** Close button, Escape. (A click on the scrim doesn't close: a half-filled form stays.) */
  onClose: () => void;
  title: string;
  /** One line under the title ("Step 2 of 5"). */
  subtitle?: ReactNode;
  /** The footer's buttons; put a `<div data-grow />` between left and right groups. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * A centred modal (docs/DESIGN.md → Layout: 720px max, 12px radius, `--scrim` behind). Built on
 * <dialog>.showModal(), so focus stays inside, Escape closes and the page behind is inert.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
  className,
  "data-testid": testId,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={[styles.modal, className].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
    >
      {open ? (
        <>
          <header className={styles.head}>
            <div className={styles.titles}>
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
              {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
            </div>
            <button
              type="button"
              className={styles.close}
              aria-label="Close"
              onClick={() => {
                onCloseRef.current();
              }}
            >
              <X aria-hidden="true" />
            </button>
          </header>
          <div className={styles.body}>{children}</div>
          {footer ? <footer className={styles.foot}>{footer}</footer> : null}
        </>
      ) : null}
    </dialog>
  );
}
