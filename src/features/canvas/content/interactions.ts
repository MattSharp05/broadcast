"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { Box } from "@/components/placement";
import type { DetailTarget } from "@/features/drawers/types";

/**
 * Hover previews and click-to-open drawers for the canvas cards (BC-15). Cards and account
 * headers carry `data-detail="post:<id>"` / `"account:<id>"`; one set of handlers on their common
 * parent does the rest (event delegation, so the memoised cards don't re-render on hover).
 *
 * - Hover (mouse only, after HOVER_DELAY_MS) shows a preview beside the card. Touch and pen don't
 *   preview: a tap opens the drawer.
 * - A press (start of a pan), a wheel or leaving the card hides it. A press that became a pan
 *   doesn't click (the canvas engine swallows that click).
 * - Click, or Enter / Space on a focused card, opens the drawer; closing it gives focus back to
 *   the card.
 */

export const HOVER_DELAY_MS = 220;
export const DETAIL_SELECTOR = "[data-detail]";

export interface Preview {
  target: DetailTarget;
  anchor: Box;
}

export interface OpenDetail {
  /** The `data-detail` key, to find the target again after the data refreshes. */
  key: string;
  target: DetailTarget;
  /** The card that opened it: focus goes back there. */
  returnFocus: HTMLElement;
}

function detailElement(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>(DETAIL_SELECTOR) : null;
}

export function useDetailInteractions(resolve: (key: string) => DetailTarget | null) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [open, setOpen] = useState<OpenDetail | null>(null);
  const hovered = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const resolveRef = useRef(resolve);
  useEffect(() => {
    resolveRef.current = resolve;
  });
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    hovered.current = null;
    setPreview(null);
  }, []);

  const openFor = useCallback(
    (el: HTMLElement) => {
      hide();
      const key = el.dataset.detail ?? "";
      const target = resolveRef.current(key);
      if (target) setOpen({ key, target, returnFocus: el });
    },
    [hide],
  );

  const onPointerOver = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "mouse") return;
      const el = detailElement(e.target);
      if (!el || el === hovered.current) return;
      hide();
      // Mid-drag (a pan sweeping over cards): no previews.
      if (e.buttons !== 0 || el.closest("[data-panning]")) return;
      hovered.current = el;
      timer.current = setTimeout(() => {
        if (hovered.current !== el || !el.isConnected) return;
        const target = resolveRef.current(el.dataset.detail ?? "");
        if (!target) return;
        const r = el.getBoundingClientRect();
        setPreview({
          target,
          anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        });
      }, HOVER_DELAY_MS);
    },
    [hide],
  );

  const onPointerOut = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const el = hovered.current;
      if (!el) return;
      const to = e.relatedTarget;
      if (to instanceof Node && el.contains(to)) return;
      hide();
    },
    [hide],
  );

  const onClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      // Links and buttons inside a card (the header's profile link) do their own thing.
      if (e.target instanceof Element && e.target.closest("a, button")) return;
      const el = detailElement(e.target);
      if (el) openFor(el);
    },
    [openFor],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.matches(DETAIL_SELECTOR)) return;
      e.preventDefault();
      openFor(el);
    },
    [openFor],
  );

  const close = useCallback(() => {
    setOpen(null);
  }, []);

  return {
    preview,
    open,
    close,
    handlers: {
      onPointerOver,
      onPointerOut,
      onPointerDown: hide,
      onWheel: hide,
      onClick,
      onKeyDown,
    },
  };
}
