/**
 * The canvas engine's DOM side: pointer, wheel and gesture input → a view, written to the world
 * layer's transform once per animation frame. React never re-renders during a pan or zoom; the
 * zoom % text, the dot grid, the minimap and the callbacks are all updated here, imperatively.
 * The maths lives in ./math (pure, unit tested).
 */
import {
  DRAG_THRESHOLD,
  ZOOM_STEP,
  applyWheel,
  centerOn,
  easeOut,
  fitBounds,
  formatZoom,
  initialView,
  lerpView,
  minimapToWorld,
  minimapTransform,
  nowView,
  panBy,
  parseView,
  pinchView,
  visibleWorldRect,
  worldToMinimap,
  zoomAt,
  zoomLevel,
  type MinimapTransform,
  type Point,
  type Rect,
  type Size,
  type View,
  type ZoomLevel,
} from "./math";

/** Colour role of a minimap rectangle; each maps to a design token. */
export type MinimapTone = "neutral" | "muted" | "accent" | "warn" | "bad" | "strong";

export interface MinimapItem {
  rect: Rect;
  tone?: MinimapTone;
}

export interface ControllerOptions {
  bounds: Rect;
  nowAnchor: Point;
  minimapItems: readonly MinimapItem[];
  /** sessionStorage key suffix; the view is remembered per key for the browser session. */
  storageKey: string;
  onScaleChange?: ((scale: number) => void) | undefined;
  onZoomLevelChange?: ((level: ZoomLevel) => void) | undefined;
}

export interface ControllerElements {
  stage: HTMLElement;
  world: HTMLElement;
  dots: HTMLElement;
  zoomText: HTMLElement;
  minimap: HTMLCanvasElement;
}

const TONE_TOKEN: Record<MinimapTone, string> = {
  neutral: "--line-2",
  muted: "--hover",
  accent: "--accent",
  warn: "--warn",
  bad: "--bad",
  strong: "--ink",
};

const DOT_SPACING = 24;
const MINIMAP_PADDING = 7;
const ANIMATION_MS = 220;
/** After this long without a frame: save the view and let the world layer re-raster. */
const IDLE_MS = 200;
const STORAGE_PREFIX = "broadcast.canvas.";

/** Elements inside the stage that never start a pan (HUD, minimap, and opted-out children). */
const NO_PAN = "[data-canvas-ui], [data-canvas-nopan]";

/** Safari's non-standard trackpad pinch events. */
interface GestureEventLike extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

interface Drag {
  pointerX: number;
  pointerY: number;
  start: View;
  moved: boolean;
}

interface Pinch {
  start: View;
  mid: Point;
  dist: number;
}

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + key, value);
  } catch {
    // Private mode or blocked storage: the view just isn't remembered.
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export class CanvasController {
  private readonly els: ControllerElements;
  private opts: ControllerOptions;
  private view: View = { x: 0, y: 0, s: 1 };
  private size: Size = { w: 0, h: 0 };
  private ready = false;
  private frame = 0;
  private lastScale = NaN;
  private lastLevel: ZoomLevel | null = null;

  private readonly pointers = new Map<number, Point>();
  private drag: Drag | null = null;
  private pinch: Pinch | null = null;
  private gestureStartScale = 1;
  private suppressClick = false;

  private animation = 0;
  /** Where the running animation ends, so repeated button presses compose (1.2 × 1.2 …). */
  private animationTarget: View | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRenderAt = 0;
  /** The stage's client rect, cached off the hot path (refreshed on resize, scroll, press). */
  private stageRect: DOMRect | null = null;

  private miniStatic: HTMLCanvasElement | null = null;
  private miniTransform: MinimapTransform | null = null;
  private miniStroke = "";
  private miniDragging = false;

  private readonly cleanups: (() => void)[] = [];

  constructor(els: ControllerElements, opts: ControllerOptions) {
    this.els = els;
    this.opts = opts;
    this.listen();
    this.measure();
  }

  // ── Public API ────────────────────────────────────────────────────────────────────────────

  getView(): View {
    return { ...this.view };
  }

  setOptions(next: ControllerOptions): void {
    const prev = this.opts;
    this.opts = next;
    if (prev.bounds !== next.bounds || prev.minimapItems !== next.minimapItems) {
      this.miniStatic = null;
      this.schedule();
    }
  }

  fitAll(): void {
    this.animateTo(fitBounds(this.opts.bounds, this.size));
  }

  backToNow(): void {
    this.animateTo(nowView(this.settled(), this.opts.nowAnchor, this.size));
  }

  zoomIn(): void {
    const v = this.settled();
    this.animateTo(zoomAt(v, this.center(), v.s * ZOOM_STEP));
  }

  zoomOut(): void {
    const v = this.settled();
    this.animateTo(zoomAt(v, this.center(), v.s / ZOOM_STEP));
  }

  /** Centres the view on a world point at the current scale. */
  centerOn(world: Point, animate = true): void {
    const target = centerOn(this.settled(), world, this.size);
    if (animate) {
      this.animateTo(target);
    } else {
      this.stopAnimation();
      this.set(target);
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.animation);
    this.flushIdle();
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
  }

  // ── View updates ──────────────────────────────────────────────────────────────────────────

  private set(view: View): void {
    this.view = view;
    this.schedule();
  }

  /** The view once any running animation has finished. */
  private settled(): View {
    return this.animationTarget ?? this.view;
  }

  private stopAnimation(): void {
    if (this.animation) cancelAnimationFrame(this.animation);
    this.animation = 0;
    this.animationTarget = null;
  }

  private animateTo(target: View): void {
    this.stopAnimation();
    if (prefersReducedMotion()) {
      this.set(target);
      return;
    }
    const from = this.view;
    const t0 = performance.now();
    this.animationTarget = target;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ANIMATION_MS);
      this.view = t < 1 ? lerpView(from, target, easeOut(t)) : target;
      this.render();
      if (t < 1) {
        this.animation = requestAnimationFrame(step);
      } else {
        this.animation = 0;
        this.animationTarget = null;
      }
    };
    this.animation = requestAnimationFrame(step);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /** Writes the view to the DOM. Runs at most once per frame. */
  private render(): void {
    if (!this.ready) return;
    const { x, y, s } = this.view;
    const { world, dots, zoomText, stage } = this.els;
    world.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
    // While moving, keep the layer on the compositor; when idle, let the browser re-raster it
    // so text is crisp at the new scale.
    world.style.willChange = "transform";

    const ox = ((x % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;
    const oy = ((y % DOT_SPACING) + DOT_SPACING) % DOT_SPACING;
    dots.style.transform = `translate3d(${ox}px, ${oy}px, 0)`;

    if (s !== this.lastScale) {
      this.lastScale = s;
      zoomText.textContent = formatZoom(s);
      const level = zoomLevel(s);
      if (level !== this.lastLevel) {
        this.lastLevel = level;
        world.dataset.zoom = level;
        stage.dataset.zoom = level;
        this.opts.onZoomLevelChange?.(level);
      }
      this.opts.onScaleChange?.(s);
    }

    this.drawMinimap();
    this.lastRenderAt = performance.now();
    this.idleTimer ??= setTimeout(this.onIdle, IDLE_MS);
  }

  /** One trailing timer per burst of frames (not one per frame): save and drop will-change. */
  private readonly onIdle = (): void => {
    const quiet = performance.now() - this.lastRenderAt;
    if (quiet < IDLE_MS) {
      this.idleTimer = setTimeout(this.onIdle, IDLE_MS - quiet);
      return;
    }
    this.idleTimer = undefined;
    this.els.world.style.willChange = "auto";
    this.save();
  };

  /** Runs a pending idle step now (page hide, unmount). */
  private flushIdle(): void {
    if (this.idleTimer === undefined) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.save();
  }

  private save(): void {
    const { x, y, s } = this.view;
    writeStorage(this.opts.storageKey, JSON.stringify({ x, y, s }));
  }

  private measure(): void {
    const r = this.els.stage.getBoundingClientRect();
    this.stageRect = r;
    this.size = { w: r.width, h: r.height };
    if (!this.ready && r.width > 0 && r.height > 0) {
      this.view =
        parseView(readStorage(this.opts.storageKey)) ?? initialView(this.opts.nowAnchor, this.size);
      this.ready = true;
      this.els.stage.dataset.ready = "true";
      this.render();
      return;
    }
    this.miniStatic = null;
    this.schedule();
  }

  private center(): Point {
    return { x: this.size.w / 2, y: this.size.h / 2 };
  }

  /** Converts client coordinates to stage-relative ones. */
  private local(clientX: number, clientY: number): Point {
    const r = (this.stageRect ??= this.els.stage.getBoundingClientRect());
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // ── Input ─────────────────────────────────────────────────────────────────────────────────

  private on<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    fn: (e: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void;
  private on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void;
  private on(
    target: EventTarget,
    type: string,
    fn: (e: never) => void,
    opts?: AddEventListenerOptions,
  ) {
    const listener = fn as unknown as EventListener;
    target.addEventListener(type, listener, opts);
    this.cleanups.push(() => {
      target.removeEventListener(type, listener, opts);
    });
  }

  private listen(): void {
    const { stage, minimap } = this.els;

    this.on(stage, "pointerdown", (e) => {
      this.onPointerDown(e);
    });
    this.on(window, "pointermove", (e) => {
      this.onPointerMove(e);
    });
    this.on(window, "pointerup", (e) => {
      this.onPointerUp(e);
    });
    this.on(window, "pointercancel", (e) => {
      this.onPointerUp(e);
    });
    // A press that turned into a pan must not also click the card under it.
    this.on(
      window,
      "click",
      (e) => {
        if (!this.suppressClick) return;
        this.suppressClick = false;
        e.stopPropagation();
        e.preventDefault();
      },
      { capture: true },
    );
    this.on(
      stage,
      "wheel",
      (e) => {
        e.preventDefault();
        this.stopAnimation();
        this.set(applyWheel(this.view, e, this.local(e.clientX, e.clientY), this.size));
        this.rebaseGesture();
      },
      { passive: false },
    );

    // Safari (macOS) reports trackpad pinch as gesture events rather than ctrl + wheel.
    const gesture = (type: string, fn: (e: GestureEventLike) => void) => {
      const listener = (e: Event) => {
        e.preventDefault();
        fn(e as GestureEventLike);
      };
      stage.addEventListener(type, listener, { passive: false });
      this.cleanups.push(() => {
        stage.removeEventListener(type, listener);
      });
    };
    // iOS fires these for touch pinches too, alongside pointer events: there the pointer pinch
    // wins and gestures are ignored while any pointer is down.
    gesture("gesturestart", () => {
      if (this.pointers.size > 0) return;
      this.stopAnimation();
      this.gestureStartScale = this.view.s;
    });
    gesture("gesturechange", (e) => {
      if (this.pointers.size > 0) return;
      this.set(
        zoomAt(this.view, this.local(e.clientX, e.clientY), this.gestureStartScale * e.scale),
      );
    });
    gesture("gestureend", () => undefined);

    this.on(minimap, "pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.stopAnimation();
      this.miniDragging = true;
      try {
        minimap.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events have no active pointer to capture.
      }
      this.minimapGo(e);
    });
    this.on(minimap, "pointermove", (e) => {
      if (this.miniDragging) this.minimapGo(e);
    });
    const endMini = () => {
      this.miniDragging = false;
    };
    this.on(minimap, "pointerup", endMini);
    this.on(minimap, "pointercancel", endMini);
    this.on(minimap, "lostpointercapture", endMini);

    const ro = new ResizeObserver(() => {
      this.measure();
    });
    ro.observe(stage);
    this.cleanups.push(() => {
      ro.disconnect();
    });

    // Theme changes (system or data-theme) recolour the minimap.
    const redrawMini = () => {
      this.miniStatic = null;
      this.schedule();
    };
    try {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", redrawMini);
      this.cleanups.push(() => {
        mq.removeEventListener("change", redrawMini);
      });
    } catch {
      // Old browsers without matchMedia listeners: no live recolouring.
    }
    const mo = new MutationObserver(redrawMini);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    this.cleanups.push(() => {
      mo.disconnect();
    });

    // The cached stage rect goes stale when the page scrolls or resizes.
    const dropRect = () => {
      this.stageRect = null;
    };
    this.on(window, "resize", dropRect);
    this.on(window, "scroll", dropRect, { capture: true, passive: true });

    // Save immediately when the page goes away.
    this.on(window, "pagehide", () => {
      this.flushIdle();
    });
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest(NO_PAN)) return;
    this.stopAnimation();
    this.stageRect = this.els.stage.getBoundingClientRect();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) this.startPinch();
    else this.startDrag(e.clientX, e.clientY);
  }

  /** A wheel zoom in the middle of a drag/pinch: continue from the new view, no snap back. */
  private rebaseGesture(): void {
    if (this.pinch) {
      this.startPinch();
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    const [p] = [...this.pointers.values()];
    if (p) this.startDrag(p.x, p.y, drag.moved);
  }

  private startDrag(x: number, y: number, moved = false): void {
    this.pinch = null;
    this.drag = { pointerX: x, pointerY: y, start: this.view, moved };
  }

  /** (Re)starts a pinch from the first two pointers; called whenever the pointer set changes. */
  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.drag = null;
    this.pinch = {
      start: this.view,
      mid: this.local((a.x + b.x) / 2, (a.y + b.y) / 2),
      dist: Math.hypot(a.x - b.x, a.y - b.y),
    };
    this.setPanning(true);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    // The release happened where the window couldn't see it (iframe, devtools, alt-tab).
    if (e.pointerType === "mouse" && e.buttons === 0) {
      this.onPointerUp(e);
      return;
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const mid = this.local((a.x + b.x) / 2, (a.y + b.y) / 2);
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      this.set(pinchView(this.pinch.start, this.pinch.mid, this.pinch.dist, mid, dist));
      return;
    }

    const drag = this.drag;
    if (!drag) return;
    const dx = e.clientX - drag.pointerX;
    const dy = e.clientY - drag.pointerY;
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      drag.moved = true;
      this.setPanning(true);
    }
    if (drag.moved) this.set(panBy(drag.start, dx, dy));
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.pointers.delete(e.pointerId)) return;
    const wasMoving = this.pinch !== null || (this.drag?.moved ?? false);
    if (this.pointers.size >= 2) {
      this.startPinch();
      return;
    }
    if (this.pointers.size === 1) {
      // One finger left after a pinch: keep panning from where it is, without a jump.
      const [rest] = [...this.pointers.values()];
      if (rest) this.startDrag(rest.x, rest.y, true);
      return;
    }
    if (this.pointers.size === 0) {
      this.drag = null;
      this.pinch = null;
      this.setPanning(false);
      // Only a real release that ended a pan is followed by a click to swallow.
      if (wasMoving && e.type === "pointerup") {
        this.suppressClick = true;
        // The click (if any) is dispatched right after pointerup; drop the flag afterwards.
        setTimeout(() => {
          this.suppressClick = false;
        }, 0);
      }
    }
  }

  private setPanning(on: boolean): void {
    if (on) this.els.stage.dataset.panning = "true";
    else delete this.els.stage.dataset.panning;
  }

  // ── Minimap ───────────────────────────────────────────────────────────────────────────────

  private minimapGo(e: PointerEvent): void {
    const m = this.miniTransform;
    if (!m) return;
    const canvas = this.els.minimap;
    const r = canvas.getBoundingClientRect();
    // The map is drawn in the canvas's content box (inside its 1px border).
    const world = minimapToWorld(m, {
      x: e.clientX - r.left - canvas.clientLeft,
      y: e.clientY - r.top - canvas.clientTop,
    });
    this.set(centerOn(this.view, world, this.size));
  }

  private token(name: string): string {
    return getComputedStyle(this.els.stage).getPropertyValue(name).trim();
  }

  /** Draws content rectangles once into an offscreen canvas (redrawn on data/theme/size change). */
  private buildMinimapStatic(w: number, h: number, dpr: number): HTMLCanvasElement | null {
    const off = document.createElement("canvas");
    off.width = Math.round(w * dpr);
    off.height = Math.round(h * dpr);
    const c = off.getContext("2d");
    if (!c) return null;
    const m = minimapTransform(this.opts.bounds, { w, h }, MINIMAP_PADDING);
    this.miniTransform = m;
    this.miniStroke = this.token("--ink");
    c.scale(dpr, dpr);
    const colours = new Map<MinimapTone, string>();
    for (const item of this.opts.minimapItems) {
      const tone = item.tone ?? "neutral";
      let fill = colours.get(tone);
      if (fill === undefined) {
        fill = this.token(TONE_TOKEN[tone]);
        colours.set(tone, fill);
      }
      c.fillStyle = fill;
      const { x0, y0, x1, y1 } = item.rect;
      const tl = worldToMinimap(m, { x: x0, y: y0 });
      c.fillRect(tl.x, tl.y, Math.max(1, (x1 - x0) * m.s), Math.max(1, (y1 - y0) * m.s));
    }
    return off;
  }

  private drawMinimap(): void {
    const canvas = this.els.minimap;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return; // hidden (phones)
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      this.miniStatic = null;
    }
    this.miniStatic ??= this.buildMinimapStatic(w, h, dpr);
    const c = canvas.getContext("2d");
    const m = this.miniTransform;
    if (!c || !m) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, bw, bh);
    if (this.miniStatic) c.drawImage(this.miniStatic, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const visible = visibleWorldRect(this.view, this.size);
    const tl = worldToMinimap(m, { x: visible.x0, y: visible.y0 });
    c.strokeStyle = this.miniStroke;
    c.lineWidth = 1.5;
    c.strokeRect(tl.x, tl.y, (visible.x1 - visible.x0) * m.s, (visible.y1 - visible.y0) * m.s);
  }
}
