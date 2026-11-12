/**
 * Every factory video carries a recipe: each part as a tag, stored on its media row
 * (`media_assets.recipe`) so the post drawer can show it next to performance, and so later A/B
 * comparisons can group by any part.
 */

export interface Recipe {
  v: 1;
  production_id: string;
  style: string | null;
  avatar: string | null;
  avatar_version: number | null;
  face_model: string | null;
  /** Share of the video's length the avatar is on screen (0–1). */
  face_share: number | null;
  voice: string | null;
  music: string | null;
  hook: string | null;
  script_version: number | null;
  series: string | null;
  cost_usd: number;
  /** Free-form extra tags (layout, experiment arm…). */
  tags: Record<string, string>;
}

export interface RecipeInput {
  productionId: string;
  style: string | null;
  avatarName: string | null;
  avatarVersion: number | null;
  faceModel: string | null;
  faceShare: number | null;
  voice: string | null;
  music: string | null;
  hook: string | null;
  scriptVersion: number | null;
  series: string | null;
  costUsd: number;
  tags?: Record<string, string>;
}

export function buildRecipe(input: RecipeInput): Recipe {
  const useAvatar = Boolean(input.avatarName);
  return {
    v: 1,
    production_id: input.productionId,
    style: input.style,
    avatar: input.avatarName,
    avatar_version: useAvatar ? input.avatarVersion : null,
    face_model: useAvatar ? input.faceModel : null,
    face_share: useAvatar ? clampShare(input.faceShare) : null,
    voice: input.voice,
    music: input.music,
    hook: input.hook,
    script_version: input.scriptVersion,
    series: input.series,
    cost_usd: Math.round(input.costUsd * 10_000) / 10_000,
    tags: input.tags ?? {},
  };
}

function clampShare(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
}

export interface RecipeRow {
  label: string;
  value: string;
}

/** The recipe as label/value rows for the post drawer (parts that are set). */
export function recipeRows(recipe: unknown): RecipeRow[] {
  if (!recipe || typeof recipe !== "object") return [];
  const r = recipe as Partial<Recipe>;
  const rows: RecipeRow[] = [];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return;
    rows.push({ label, value: String(value) });
  };
  add("Style", r.style);
  if (r.avatar) add("Avatar", `${r.avatar}${r.avatar_version ? ` v${r.avatar_version}` : ""}`);
  add("Face model", r.face_model);
  if (typeof r.face_share === "number") add("Face share", `${Math.round(r.face_share * 100)}%`);
  add("Voice", r.voice);
  add("Music", r.music);
  add("Hook", r.hook);
  if (r.script_version) add("Script", `v${r.script_version}`);
  add("Series", r.series);
  if (typeof r.cost_usd === "number") add("Cost", `$${r.cost_usd.toFixed(2)}`);
  return rows;
}
