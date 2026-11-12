import type { SupabaseClient } from "@supabase/supabase-js";
import { monthStart, spendOf, type Caps } from "@/lib/domain/factory/budget";
import type { FactoryStep, StepModes, StepStatus } from "@/lib/domain/factory/steps";
import { parseModes } from "@/lib/domain/factory/steps";
import type { Database, Json } from "./types";

/**
 * Content Factory queries. Every query is scoped by workspace_id. Callers pass the service-role
 * client (generation and tokens) or the user's client (reads on the page).
 */

export type Db = SupabaseClient<Database>;
export type ProductionRow = Database["public"]["Tables"]["productions"]["Row"];
export type StepRow = Database["public"]["Tables"]["production_steps"]["Row"];
export type GenJobRow = Database["public"]["Tables"]["gen_jobs"]["Row"];
export type AvatarRow = Database["public"]["Tables"]["avatars"]["Row"];
export type ReworkRow = Database["public"]["Tables"]["production_reworks"]["Row"];
export type VoiceRow = Database["public"]["Tables"]["factory_voices"]["Row"];
export type MusicRow = Database["public"]["Tables"]["factory_music"]["Row"];

export class FactoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FactoryError";
  }
}

export function fail(what: string, error: { message: string }): never {
  throw new Error(`Content Factory: ${what} failed: ${error.message}`);
}

export interface FactorySettings {
  caps: Caps;
  enabledModels: string[];
  defaultFaceModel: string;
  fallbackFaceModel: string | null;
  stepModes: StepModes;
}

export async function loadFactorySettings(db: Db, workspaceId: string): Promise<FactorySettings> {
  const { data, error } = await db
    .from("factory_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) fail("reading the settings", error);
  return {
    caps: {
      perVideoUsd: data?.cap_per_video_usd ?? 5,
      monthlyUsd: data?.cap_monthly_usd ?? 50,
    },
    enabledModels: data?.enabled_models ?? ["placeholder"],
    defaultFaceModel: data?.default_face_model ?? "placeholder",
    fallbackFaceModel: data?.fallback_face_model ?? null,
    stepModes: parseModes(data?.step_modes),
  };
}

export async function getProduction(db: Db, ws: string, id: string): Promise<ProductionRow> {
  const { data, error } = await db
    .from("productions")
    .select("*")
    .eq("workspace_id", ws)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("reading the video", error);
  if (!data) throw new FactoryError("not_found", "That video doesn't exist in this workspace.");
  return data;
}

export async function getSteps(db: Db, ws: string, productionId: string): Promise<StepRow[]> {
  const { data, error } = await db
    .from("production_steps")
    .select("*")
    .eq("workspace_id", ws)
    .eq("production_id", productionId);
  if (error) fail("reading the steps", error);
  return data;
}

export async function updateStep(
  db: Db,
  ws: string,
  productionId: string,
  step: FactoryStep,
  patch: Partial<{
    status: StepStatus;
    progress: number;
    message: string | null;
    output: NonNullable<Json>;
    attempt: number;
    session_id: string | null;
    session_url: string | null;
    started_at: string | null;
    finished_at: string | null;
  }>,
): Promise<void> {
  const { error } = await db
    .from("production_steps")
    .update(patch)
    .eq("workspace_id", ws)
    .eq("production_id", productionId)
    .eq("step", step);
  if (error) fail(`saving the ${step} step`, error);
}

export async function updateProduction(
  db: Db,
  ws: string,
  id: string,
  patch: Database["public"]["Tables"]["productions"]["Update"],
): Promise<void> {
  const { error } = await db.from("productions").update(patch).eq("workspace_id", ws).eq("id", id);
  if (error) fail("saving the video", error);
}

export async function jobsFor(db: Db, ws: string, productionId: string): Promise<GenJobRow[]> {
  const { data, error } = await db
    .from("gen_jobs")
    .select("*")
    .eq("workspace_id", ws)
    .eq("production_id", productionId)
    .order("created_at");
  if (error) fail("reading the generation jobs", error);
  return data;
}

/** Spend on one video and this (UTC) month, from the job log. */
export async function spendSoFar(
  db: Db,
  ws: string,
  productionId: string | null,
  now: Date,
): Promise<{ videoUsd: number; monthUsd: number }> {
  const month = await db
    .from("gen_jobs")
    .select("production_id, status, quote_usd, cost_usd")
    .eq("workspace_id", ws)
    .gte("created_at", monthStart(now).toISOString());
  if (month.error) fail("reading this month's spend", month.error);
  const video = productionId
    ? await db
        .from("gen_jobs")
        .select("status, quote_usd, cost_usd")
        .eq("workspace_id", ws)
        .eq("production_id", productionId)
    : { data: [], error: null };
  if (video.error) fail("reading the video's spend", video.error);
  return { videoUsd: spendOf(video.data), monthUsd: spendOf(month.data) };
}

export async function getAvatar(db: Db, ws: string, id: string): Promise<AvatarRow | null> {
  const { data, error } = await db
    .from("avatars")
    .select("*")
    .eq("workspace_id", ws)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("reading the avatar", error);
  return data;
}

/** The avatar's own per-video cap (`generation.cost_cap_per_video_usd`), if it sets one. */
export function avatarCap(avatar: AvatarRow | null): number | null {
  const gen = (avatar?.profile as { generation?: { cost_cap_per_video_usd?: unknown } } | null)
    ?.generation;
  const cap = gen?.cost_cap_per_video_usd;
  return typeof cap === "number" ? cap : null;
}

/** The avatar's face model settings (`generation.face_model`, `fallback_model`, `seed`). */
export function avatarGeneration(avatar: AvatarRow | null): {
  faceModel: string | null;
  fallbackModel: string | null;
  seed: number | null;
} {
  const gen = (avatar?.profile as { generation?: Record<string, unknown> } | null)?.generation;
  return {
    faceModel: typeof gen?.face_model === "string" ? gen.face_model : null,
    fallbackModel: typeof gen?.fallback_model === "string" ? gen.fallback_model : null,
    seed: typeof gen?.seed === "number" ? gen.seed : null,
  };
}

export async function openRedoSlots(db: Db, ws: string, productionId: string): Promise<string[]> {
  const { data, error } = await db
    .from("production_reworks")
    .select("ref")
    .eq("workspace_id", ws)
    .eq("production_id", productionId)
    .eq("target", "avatar_slot")
    .neq("status", "done");
  if (error) fail("reading the reworks", error);
  return data.map((r) => r.ref).filter((r): r is string => Boolean(r));
}
