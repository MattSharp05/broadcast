"use client";

import { useCallback, useLayoutEffect, useRef, type ComponentProps, type Ref } from "react";

export interface TextAreaProps extends ComponentProps<"textarea"> {
  /** Grows with its text up to this many lines, then scrolls. Starts at `rows`. */
  maxRows?: number;
}

/**
 * Makes the textarea as tall as its text: never shorter than its `rows` (or CSS) height, never
 * taller than `maxRows` lines; past that it scrolls.
 */
export function fitTextArea(el: HTMLTextAreaElement | null, maxRows: number): void {
  if (!el) return;
  el.style.height = "";
  if (el.scrollHeight <= el.clientHeight) return;
  const cs = getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize) || 14;
  const line = parseFloat(cs.lineHeight) || fontSize * 1.2;
  const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const borders = el.offsetHeight - el.clientHeight;
  const max = Math.max(el.offsetHeight, line * maxRows + padding + borders);
  el.style.height = `${Math.min(el.scrollHeight + borders, max)}px`;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * A <textarea> that grows a line at a time as you type, up to `maxRows` (default 12), and scrolls
 * after that. Use it for every multi-line field.
 */
export function TextArea({ maxRows = 12, ref, onInput, value, ...props }: TextAreaProps) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      inner.current = el;
      assignRef(ref, el);
    },
    [ref],
  );

  // Controlled: after every value change (typing, a reset, text set from outside).
  useLayoutEffect(() => {
    fitTextArea(inner.current, maxRows);
  }, [value, maxRows]);

  // Width changes rewrap the text.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitTextArea(el, maxRows);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [maxRows]);

  return (
    <textarea
      {...props}
      ref={setRef}
      value={value}
      onInput={(e) => {
        fitTextArea(e.currentTarget, maxRows);
        onInput?.(e);
      }}
    />
  );
}
