"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ItemDragHandler, Point } from "@/features/canvas/engine";
import type { CanvasLayout } from "../layout";
import { DRAGGABLE_KINDS, dropTargets, hitTarget, type DropTarget } from "./targets";

/** What the drop-target overlay shows while a card is dragged. */
export interface CardDragState {
  cardId: string;
  targets: DropTarget[];
  /** Key of the target under the pointer. */
  active: string | null;
}

export interface CardDragOptions {
  layout: CanvasLayout;
  /** Off when the queue can't be edited (no actions). */
  enabled: boolean;
  /** Whether a post of `sourceId` can move to `targetId`. */
  accepts: (targetId: string, sourceId: string) => boolean;
  onDrop: (cardId: string, target: DropTarget) => void;
}

interface Live {
  el: HTMLElement;
  cardId: string;
  origin: Point;
  targets: DropTarget[];
  active: DropTarget | null;
}

/**
 * Dragging queued cards on the Workflow canvas (BC-22). The canvas engine decides when a press
 * becomes a card drag (hold or move, see ItemDragHandler); this moves the card with the pointer
 * (a transform on the card itself, in world units, so React doesn't re-render per frame), finds
 * the target under it and reports the drop. Only the target highlight is React state.
 */
export function useCardDrag(options: CardDragOptions) {
  const [state, setState] = useState<CardDragState | null>(null);
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });
  const live = useRef<Live | null>(null);

  const handler = useMemo<ItemDragHandler>(
    () => ({
      pick(target) {
        if (!opts.current.enabled) return null;
        const el = target.closest<HTMLElement>("[data-post]");
        if (!el || !DRAGGABLE_KINDS.has(el.dataset.kind ?? "")) return null;
        return el;
      },
      start(el, world) {
        const cardId = el.dataset.post ?? "";
        const { layout, accepts } = opts.current;
        const source = layout.columns.find((c) => c.upcoming.some((u) => u.item.id === cardId))
          ?.column.id;
        if (!source) return;
        const targets = dropTargets(layout, cardId, (id) => accepts(id, source));
        live.current = { el, cardId, origin: world, targets, active: null };
        el.setAttribute("data-dragging", "");
        setState({ cardId, targets, active: null });
      },
      move(world) {
        const l = live.current;
        if (!l) return;
        l.el.style.transform = `translate(${world.x - l.origin.x}px, ${world.y - l.origin.y}px)`;
        const hit = hitTarget(l.targets, world);
        if (hit?.key === l.active?.key) return;
        l.active = hit;
        setState((s) => (s ? { ...s, active: hit?.key ?? null } : s));
      },
      end(drop) {
        const l = live.current;
        live.current = null;
        setState(null);
        if (!l) return;
        l.el.style.transform = "";
        l.el.removeAttribute("data-dragging");
        if (drop && l.active) opts.current.onDrop(l.cardId, l.active);
      },
    }),
    [],
  );

  return { handler, drag: state };
}
