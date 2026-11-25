import packs from "@/lib/factory/style-packs.json";
import type { StyleEntry } from "./style-packs";

/**
 * The animated-video styles, mirrored from video-editor (`.claude/skills/animated-video/styles/`)
 * into `src/lib/factory/style-packs.json` by `node scripts/sync-style-packs.mjs`. A video picks one
 * of the styles that has a pack; the example frame is a still from a past project where one exists.
 */

export type StyleKey = string;

export interface StylePack {
  key: StyleKey;
  label: string;
  suits: string;
  signature: string;
  typicalFailure: string;
  /** Path under /public, or null when no past project used the style yet. */
  example: string | null;
  /** Where the example frame comes from. */
  exampleFrom: string | null;
}

/** Example frames from past projects (kept here: they're Broadcast's files, not video-editor's). */
const EXAMPLES: Record<string, { example: string; exampleFrom: string }> = {
  "editorial-collage": {
    example: "/factory/styles/editorial-collage.jpg",
    exampleFrom: "Trip social 01, style frame C",
  },
  "luminous-3d": {
    example: "/factory/styles/luminous-3d.jpg",
    exampleFrom: "Trip social 01, style frame A",
  },
  "motion-graphics": {
    example: "/factory/styles/motion-graphics.jpg",
    exampleFrom: "Trip social 01, style frame B (picked)",
  },
  "realistic-3d": {
    example: "/factory/styles/realistic-3d.jpg",
    exampleFrom: "Grand Canyon 01",
  },
};

/** Every style in video-editor's list, with or without a pack. */
export const ALL_STYLES: readonly StyleEntry[] = packs;

/** The styles a video can pick (those with a pack), in alphabetical order. */
export const STYLE_PACKS: readonly StylePack[] = packs
  .filter((p) => p.has_pack)
  .map((p) => ({
    key: p.key,
    label: p.label,
    suits: p.suits,
    signature: p.signature,
    typicalFailure: p.typical_failure,
    example: EXAMPLES[p.key]?.example ?? null,
    exampleFrom: EXAMPLES[p.key]?.exampleFrom ?? null,
  }))
  .sort((a, b) => a.key.localeCompare(b.key));

export function stylePack(key: string | null | undefined): StylePack | undefined {
  return STYLE_PACKS.find((s) => s.key === key);
}
