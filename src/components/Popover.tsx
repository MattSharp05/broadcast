"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeBeside, type Box } from "./placement";
import styles from "./Popover.module.css";

export interface PopoverProps {
  /** The element's viewport rectangle (getBoundingClientRect) the popover sits beside. */
  anchor: Box;
  children: ReactNode;
  id?: string;
  /** Default 272px (DESIGN.md → popovers). */
  width?: number;
  className?: string;
  "data-testid"?: string;
}

/**
 * A preview panel beside an anchor: right of it, else left, else below or above, so it never
 * covers the thing it describes. Non-interactive (pointer-events: none) and role="tooltip": the
 * same information is always reachable by clicking (a drawer). Rendered into document.body.
 */
export function Popover({
  anchor,
  children,
  id,
  width = 272,
  className,
  "data-testid": testId,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: string } | null>(null);
  const { left, top, right, bottom } = anchor;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(
      placeBeside(
        { left, top, right, bottom },
        { width, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [left, top, right, bottom, width, children]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className={[styles.popover, className].filter(Boolean).join(" ")}
      style={{ width, left: pos?.left ?? 0, top: pos?.top ?? 0 }}
      data-open={pos ? "true" : undefined}
      data-side={pos?.side}
      data-testid={testId}
    >
      {children}
    </div>,
    document.body,
  );
}
