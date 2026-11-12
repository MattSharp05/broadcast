/**
 * The animated-video style packs (video-editor `.claude/skills/animated-video/styles/`). The
 * example frame is a still from a past project where one exists.
 */

export type StyleKey =
  "editorial-collage" | "handmade-2d" | "luminous-3d" | "motion-graphics" | "realistic-3d";

export interface StylePack {
  key: StyleKey;
  label: string;
  suits: string;
  signature: string;
  /** Path under /public, or null when no past project used the style yet. */
  example: string | null;
  /** Where the example frame comes from. */
  exampleFrom: string | null;
}

export const STYLE_PACKS: readonly StylePack[] = [
  {
    key: "editorial-collage",
    label: "Editorial collage",
    suits: "Investigations, history, money, politics",
    signature: "Cutouts on a paper board, marker circles and arrows, typed labels",
    example: "/factory/styles/editorial-collage.jpg",
    exampleFrom: "Trip social 01, style frame C",
  },
  {
    key: "handmade-2d",
    label: "Handmade 2D",
    suits: "Personal stories, warmth, charm",
    signature: "Paper grain, irregular edges, held drawings with line boil",
    example: null,
    exampleFrom: null,
  },
  {
    key: "luminous-3d",
    label: "Luminous 3D",
    suits: "Systems, infrastructure, science, scale",
    signature: "Dark space, light-emitting data, fog, a camera travelling macro to micro",
    example: "/factory/styles/luminous-3d.jpg",
    exampleFrom: "Trip social 01, style frame A",
  },
  {
    key: "motion-graphics",
    label: "Motion graphics",
    suits: "Data, processes, software launches",
    signature: "A strict system of type, shape and colour; the real interface",
    example: "/factory/styles/motion-graphics.jpg",
    exampleFrom: "Trip social 01, style frame B (picked)",
  },
  {
    key: "realistic-3d",
    label: "Realistic 3D",
    suits: "Places, machines, nature",
    signature: "Real scale, materials, sky light and weighted motion",
    example: "/factory/styles/realistic-3d.jpg",
    exampleFrom: "Grand Canyon 01",
  },
];

export function stylePack(key: string | null | undefined): StylePack | undefined {
  return STYLE_PACKS.find((s) => s.key === key);
}
