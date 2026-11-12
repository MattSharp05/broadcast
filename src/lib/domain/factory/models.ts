import registry from "@/lib/factory/face-models.json";

/**
 * The face model registry: a mirror of video-editor's
 * `.claude/skills/avatar-cutins/scripts/face_models.json` (copy it again with
 * `node scripts/sync-face-models.mjs`). `planned` models are listed but can't be picked.
 */

export type ModelStatus = "ready" | "untested" | "planned";

export interface FaceModel {
  key: string;
  label: string;
  provider: string;
  endpoint?: string;
  pricePerS: number;
  maxS: number;
  /** Billing rounds up to this many seconds (e.g. 6 s blocks); 1 when absent. */
  billingIncrementS: number;
  status: ModelStatus;
  notes: string;
  /** Request field names for the image, audio and prompt inputs (fal). */
  inputs?: { image: string; audio: string; prompt?: string };
  /** Dotted path of the output video URL in the provider's response. */
  output?: string;
}

interface RawModel {
  key: string;
  label: string;
  provider: string;
  endpoint?: string;
  price_usd_per_s: number;
  max_s: number;
  billing_increment_s?: number;
  status: string;
  notes?: string;
  inputs?: { image: string; audio: string; prompt?: string };
  output?: string;
}

function toModel(raw: RawModel): FaceModel {
  const status: ModelStatus =
    raw.status === "ready" || raw.status === "untested" ? raw.status : "planned";
  return {
    key: raw.key,
    label: raw.label,
    provider: raw.provider,
    endpoint: raw.endpoint,
    pricePerS: raw.price_usd_per_s,
    maxS: raw.max_s,
    billingIncrementS: raw.billing_increment_s ?? 1,
    status,
    notes: raw.notes ?? "",
    inputs: raw.inputs,
    output: raw.output,
  };
}

export const FACE_MODELS: readonly FaceModel[] = (registry.models as RawModel[]).map(toModel);
export const DEFAULT_FACE_PROMPT: string = registry.default_prompt;
export const PLACEHOLDER_MODEL = "placeholder";

export function faceModel(key: string | null | undefined): FaceModel | undefined {
  return key ? FACE_MODELS.find((m) => m.key === key) : undefined;
}

/** Free models need no key and cost nothing (the placeholder). */
export function isFree(model: FaceModel): boolean {
  return model.pricePerS === 0;
}

/** Planned models have no adapter: shown, never selectable. */
export function isSelectable(model: FaceModel): boolean {
  return model.status !== "planned";
}

/**
 * Models that can be enabled: selectable, and either free or from a provider with a saved key.
 */
export function enableableModels(providersWithKey: readonly string[]): FaceModel[] {
  return FACE_MODELS.filter(
    (m) => isSelectable(m) && (isFree(m) || providersWithKey.includes(m.provider)),
  );
}

/** Price of `seconds` of a model, rounded up to its billing increment. */
export function priceFor(model: FaceModel, seconds: number): number {
  if (seconds <= 0) return 0;
  const inc = model.billingIncrementS;
  const billed = Math.ceil(seconds / inc - 1e-9) * inc;
  return roundUsd(billed * model.pricePerS);
}

export function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export interface ModelChoice {
  /** The model a video's avatar clips use. */
  key: string;
  /** Where the choice came from. */
  source: "video" | "avatar" | "account" | "workspace";
}

/**
 * Account default, then avatar default, then a per-video override (the later one wins), then the
 * workspace default. A choice that is not enabled is skipped.
 */
export function resolveFaceModel(input: {
  video?: string | null;
  avatar?: string | null;
  account?: string | null;
  workspaceDefault: string;
  enabled: readonly string[];
}): ModelChoice {
  const ok = (k: string | null | undefined): k is string =>
    typeof k === "string" && input.enabled.includes(k) && Boolean(faceModel(k));
  if (ok(input.video)) return { key: input.video, source: "video" };
  if (ok(input.avatar)) return { key: input.avatar, source: "avatar" };
  if (ok(input.account)) return { key: input.account, source: "account" };
  return { key: input.workspaceDefault, source: "workspace" };
}
