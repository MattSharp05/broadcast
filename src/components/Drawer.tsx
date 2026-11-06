"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import styles from "./Drawer.module.css";

export interface DrawerProps {
  /** Renders nothing while false. */
  open: boolean;
  /** Called on Escape, the scrim, and the close button. */
  onClose: () => void;
  /** The heading (also the dialog's accessible name). */
  title: ReactNode;
  /** One line under the heading. */
  subtitle?: ReactNode;
  /** Shown before the heading (e.g. an avatar). */
  lead?: ReactNode;
  children: ReactNode;
  /**
   * Where focus goes when the drawer closes. Default: the element that had focus when it opened.
   */
  returnFocus?: HTMLElement | null;
  className?: string;
  "data-testid"?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal panel that slides in from the right (440px max; full width on phones), over a scrim.
 * Accessible: role="dialog" + aria-modal, labelled by its title; focus moves into it, Tab stays
 * inside, Escape / the scrim / the close button close it, and focus goes back where it was.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  lead,
  children,
  returnFocus,
  className,
  "data-testid": testId,
}: DrawerProps) {
  const titleId = useId();
  const subtitleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const returnRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // While open: remember where focus was, move it in, close on Escape, give it back on close.
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    returnRef.current = returnFocus ?? (active instanceof HTMLElement ? active : null);
    panelRef.current?.focus({ preventScroll: true });

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const back = returnRef.current;
      returnRef.current = null;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
    // returnFocus is read when the drawer opens only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function trapTab(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.root}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" data-drawer-scrim="" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className={[styles.panel, className].filter(Boolean).join(" ")}
        onKeyDown={trapTab}
        data-testid={testId}
      >
        <header className={styles.head}>
          {lead}
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle ? (
              <p id={subtitleId} className={styles.subtitle}>
                {subtitle}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" className={styles.close} aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
