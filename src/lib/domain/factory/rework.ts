import type { FactoryStep } from "./steps";

/**
 * Rework (pure): what to redo and which step reruns. Only an explicit avatar-slot redo pays
 * again; everything else reuses the paid face clips (the proxy returns the kept clip per slot).
 */

export type ReworkTarget = "script_line" | "scene" | "voice" | "music" | "caption" | "avatar_slot";

export const REWORK_LABELS: Record<ReworkTarget, string> = {
  script_line: "Script lines",
  scene: "A scene",
  voice: "Voice",
  music: "Music",
  caption: "Caption",
  avatar_slot: "An avatar slot",
};

/** The step a rework reruns from (caption is rewritten on the page: no step). */
export function reworkStep(target: ReworkTarget): FactoryStep | null {
  switch (target) {
    case "script_line":
      return "script";
    case "scene":
      return "visuals";
    case "voice":
    case "music":
    case "avatar_slot":
      return "render";
    case "caption":
      return null;
  }
}

export function isPaidRework(target: ReworkTarget): boolean {
  return target === "avatar_slot";
}

export function isReworkTarget(value: unknown): value is ReworkTarget {
  return typeof value === "string" && value in REWORK_LABELS;
}

export interface ScriptLine {
  id: string;
  text: string;
  /** The avatar slot this line is spoken in, if any. */
  slot?: string | null;
}

/**
 * Avatar slots a script-line rework touches: changing a line the avatar speaks needs a paid redo
 * of that slot, so the page asks for it explicitly instead of doing it silently.
 */
export function slotsTouched(lines: readonly ScriptLine[], lineIds: readonly string[]): string[] {
  const out = new Set<string>();
  for (const l of lines) if (lineIds.includes(l.id) && l.slot) out.add(l.slot);
  return [...out];
}
