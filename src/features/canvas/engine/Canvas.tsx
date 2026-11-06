"use client";

import { LocateFixed, Minus, Plus, Scan } from "lucide-react";
import { useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import styles from "./Canvas.module.css";
import { CanvasController, type ControllerOptions, type MinimapItem } from "./controller";
import type { Point, Rect, View, ZoomLevel } from "./math";

export interface CanvasHandle {
  fitAll: () => void;
  backToNow: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Centres the view on a world point at the current scale. */
  centerOn: (world: Point) => void;
  getView: () => View | null;
}

export interface CanvasProps {
  /** World-space rectangle around all content: used by "Fit all" and the minimap. */
  bounds: Rect;
  /** World point that "Back to now" brings to the left edge, vertically centred. */
  nowAnchor: Point;
  /** Rectangles drawn on the minimap (world coordinates). Keep the array stable between renders. */
  minimapItems?: readonly MinimapItem[];
  /** The view is remembered per key for the browser session (sessionStorage). */
  storageKey?: string;
  /** Called on every frame whose scale changed. Don't set React state from it on every call. */
  onScaleChange?: (scale: number) => void;
  /** Called when the scale crosses the semantic-zoom threshold (far below 60%). */
  onZoomLevelChange?: (level: ZoomLevel) => void;
  "aria-label"?: string;
  className?: string;
  ref?: Ref<CanvasHandle>;
  /** Absolutely positioned in world coordinates. The world layer carries data-zoom="near|far". */
  children?: ReactNode;
}

const NO_ITEMS: readonly MinimapItem[] = [];

/**
 * A pan/zoom canvas: drag (4px threshold) or wheel to pan, shift + wheel sideways, ctrl/cmd +
 * wheel or pinch to zoom around the pointer, a zoom HUD bottom-left and a minimap bottom-right.
 * The engine writes the transform directly (see ./controller); React doesn't re-render while
 * panning. Give the canvas a height through its parent or className.
 */
export function Canvas({
  bounds,
  nowAnchor,
  minimapItems = NO_ITEMS,
  storageKey = "default",
  onScaleChange,
  onZoomLevelChange,
  "aria-label": ariaLabel = "Canvas",
  className,
  ref,
  children,
}: CanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const zoomTextRef = useRef<HTMLOutputElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<CanvasController | null>(null);

  const options: ControllerOptions = {
    bounds,
    nowAnchor,
    minimapItems,
    storageKey,
    onScaleChange,
    onZoomLevelChange,
  };
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
    controllerRef.current?.setOptions(options);
  });

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const world = worldRef.current;
    const dots = dotsRef.current;
    const zoomText = zoomTextRef.current;
    const minimap = minimapRef.current;
    if (!stage || !world || !dots || !zoomText || !minimap) return;
    const controller = new CanvasController(
      { stage, world, dots, zoomText, minimap },
      optionsRef.current,
    );
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
    // The storage key picks which remembered view to start from, so a new key restarts.
  }, [storageKey]);

  useImperativeHandle(
    ref,
    () => ({
      fitAll: () => controllerRef.current?.fitAll(),
      backToNow: () => controllerRef.current?.backToNow(),
      zoomIn: () => controllerRef.current?.zoomIn(),
      zoomOut: () => controllerRef.current?.zoomOut(),
      centerOn: (world: Point) => controllerRef.current?.centerOn(world),
      getView: () => controllerRef.current?.getView() ?? null,
    }),
    [],
  );

  return (
    <div
      ref={stageRef}
      className={[styles.stage, className].filter(Boolean).join(" ")}
      role="region"
      aria-label={ariaLabel}
      data-canvas-stage=""
    >
      <div ref={dotsRef} className={styles.dots} aria-hidden="true" />
      <div ref={worldRef} className={styles.world} data-canvas-world="">
        {children}
      </div>

      <div className={styles.hud} data-canvas-ui="" role="toolbar" aria-label="Zoom">
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Zoom out"
          onClick={() => controllerRef.current?.zoomOut()}
        >
          <Minus aria-hidden="true" />
        </button>
        <output
          ref={zoomTextRef}
          className={styles.zoomText}
          aria-label="Zoom level"
          aria-live="off"
        >
          100%
        </output>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Zoom in"
          onClick={() => controllerRef.current?.zoomIn()}
        >
          <Plus aria-hidden="true" />
        </button>
        <span className={styles.sep} aria-hidden="true" />
        <button
          type="button"
          className={styles.textButton}
          onClick={() => controllerRef.current?.fitAll()}
        >
          <Scan aria-hidden="true" />
          Fit all
        </button>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => controllerRef.current?.backToNow()}
        >
          <LocateFixed aria-hidden="true" />
          Back to now
        </button>
      </div>

      <canvas
        ref={minimapRef}
        className={styles.minimap}
        data-canvas-ui=""
        role="img"
        aria-label="Minimap. Click or drag to move the view."
      />
    </div>
  );
}
