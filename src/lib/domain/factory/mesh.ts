import registry from "@/lib/factory/mesh-models.json";

/**
 * Hero 3D assets (pure): the mesh model registry (a mirror of video-editor's
 * `.claude/skills/hero-assets/scripts/mesh_models.json`), prices with options, the fal input built
 * from the registry, and the approval rule: a mesh job needs a `generate` decision for that model.
 */

export interface MeshOption {
  usd: number;
  inputs: Record<string, unknown>;
  excludes?: string[];
}

export interface MeshModel {
  key: string;
  label: string;
  provider: string;
  endpoint?: string;
  endpointText?: string;
  text: boolean;
  inputs: Record<string, string | null>;
  baseInputs: Record<string, unknown>;
  priceUsd: number;
  options: Record<string, MeshOption>;
  defaultOptions: string[];
  output?: string;
  status: "ready" | "untested" | "planned";
  licence: { summary: string; commercial?: boolean; credit?: string };
  notes: string;
}

interface RawMesh {
  key: string;
  label: string;
  provider: string;
  endpoint?: string;
  endpoint_text?: string;
  text?: boolean;
  inputs?: Record<string, string | null>;
  base_inputs?: Record<string, unknown>;
  price_usd: number;
  options?: Record<string, MeshOption>;
  default_options?: string[];
  output?: string;
  status: string;
  licence?: { summary: string; commercial?: boolean; credit?: string };
  notes?: string;
}

export const MESH_MODELS: readonly MeshModel[] = (registry.models as RawMesh[]).map((m) => ({
  key: m.key,
  label: m.label,
  provider: m.provider,
  endpoint: m.endpoint,
  endpointText: m.endpoint_text,
  text: m.text ?? false,
  inputs: m.inputs ?? {},
  baseInputs: m.base_inputs ?? {},
  priceUsd: m.price_usd,
  options: m.options ?? {},
  defaultOptions: m.default_options ?? [],
  output: m.output,
  status: m.status === "ready" || m.status === "untested" ? m.status : "planned",
  licence: m.licence ?? { summary: "" },
  notes: m.notes ?? "",
}));

export function meshModel(key: string | null | undefined): MeshModel | undefined {
  return key ? MESH_MODELS.find((m) => m.key === key) : undefined;
}

export function isMeshSelectable(m: MeshModel): boolean {
  return m.status !== "planned";
}

/** The options to apply: the chosen ones (known to the model), else the model's defaults. */
export function meshOptions(
  m: MeshModel,
  chosen: Record<string, unknown> | string[] | null | undefined,
): string[] {
  let keys: string[];
  if (Array.isArray(chosen)) keys = chosen.filter((k): k is string => typeof k === "string");
  else if (chosen && typeof chosen === "object")
    keys = Object.entries(chosen)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
  else keys = m.defaultOptions;
  const known = keys.filter((k) => k in m.options);
  // An option that excludes another (Tripo HD replaces the standard texture) wins.
  const excluded = new Set(known.flatMap((k) => m.options[k]?.excludes ?? []));
  return known.filter((k) => !excluded.has(k));
}

export function meshPrice(m: MeshModel, options: readonly string[]): number {
  const extra = options.reduce((s, k) => s + (m.options[k]?.usd ?? 0), 0);
  return Math.round((m.priceUsd + extra) * 10_000) / 10_000;
}

export interface FalMeshRequest {
  endpoint: string;
  input: Record<string, unknown>;
  output: string;
}

/** The fal request from the registry (the client's own fal_input is never trusted). */
export function falMeshRequest(
  m: MeshModel,
  req: {
    mode: "image" | "text";
    image: string | null;
    prompt: string | null;
    seed: number | null;
    options: readonly string[];
  },
): FalMeshRequest | null {
  const endpoint = req.mode === "text" ? m.endpointText : m.endpoint;
  if (!endpoint || !m.output) return null;
  const input: Record<string, unknown> = { ...m.baseInputs };
  for (const k of req.options) Object.assign(input, m.options[k]?.inputs ?? {});
  if (req.mode === "image") {
    const field = m.inputs.image;
    if (!field || !req.image) return null;
    input[field] = req.image;
  }
  if (req.prompt && m.inputs.prompt) input[m.inputs.prompt] = req.prompt;
  const seedField = req.mode === "text" ? (m.inputs.seed_text ?? m.inputs.seed) : m.inputs.seed;
  if (req.seed !== null && seedField) input[seedField] = req.seed;
  return { endpoint, input, output: m.output };
}

export type HeroStage = "proposal" | "comparison";
export type HeroChoice =
  "keep_threejs" | "redo_threejs" | "generate" | "use_generated" | "keep_threejs_after_compare";

export const CHOICES: Record<HeroStage, readonly HeroChoice[]> = {
  proposal: ["keep_threejs", "redo_threejs", "generate"],
  comparison: ["use_generated", "keep_threejs_after_compare", "redo_threejs", "generate"],
};

export const CHOICE_LABELS: Record<HeroChoice, string> = {
  keep_threejs: "Keep three.js",
  redo_threejs: "Redo three.js with notes",
  generate: "Generate",
  use_generated: "Use generated",
  keep_threejs_after_compare: "Keep three.js",
};

export function isChoice(stage: HeroStage, v: unknown): v is HeroChoice {
  return typeof v === "string" && (CHOICES[stage] as readonly string[]).includes(v);
}

export interface DecisionLike {
  choice: string;
  model: string | null;
  budget_usd: number | null;
  decided_at: string;
}

/**
 * Whether a mesh job for `model` may run: the proposal's latest decision is `generate` with that
 * model, and the server's quote fits its budget. Autopilot never makes this decision.
 */
export function meshApproval(
  decisions: readonly DecisionLike[],
  model: string,
  quoteUsd: number,
): { ok: true } | { ok: false; reason: "not_approved" | "over_budget" } {
  const latest = [...decisions].sort((a, b) => b.decided_at.localeCompare(a.decided_at))[0];
  if (latest?.choice !== "generate" || latest.model !== model)
    return { ok: false, reason: "not_approved" };
  if (latest.budget_usd !== null && quoteUsd > latest.budget_usd + 1e-9)
    return { ok: false, reason: "over_budget" };
  return { ok: true };
}
