"use server";

import { revalidatePath } from "next/cache";
import { nowFor } from "@/lib/clock";
import { TokenKeyError } from "@/lib/crypto/tokens";
import { createAdminSupabase } from "@/lib/db/admin";
import { isSignedInOwner } from "@/lib/db/auth";
import { FactoryError, fail } from "@/lib/db/factory";
import { currentWorkspace } from "@/lib/db/workspace";
import { faceModel, isFree, isSelectable } from "@/lib/domain/factory/models";
import { ALL_STEPS, isStep } from "@/lib/domain/factory/steps";
import { GenError, deleteGenKey, saveGenKey, testGenKey, type GenContext } from "@/lib/factory/gen";
import { isKeyProvider } from "@/lib/factory/gen-providers";
import type { FactoryResult } from "../actions";

/**
 * Content Factory settings: generation keys (encrypted, never sent back), face models, caps and
 * default approval modes. Service role, after checking the signed-in owner.
 */

async function gen(): Promise<GenContext> {
  if (!(await isSignedInOwner())) throw new FactoryError("signed_out", "Sign in again.");
  const workspace = await currentWorkspace();
  return {
    db: createAdminSupabase(),
    workspaceId: workspace.id,
    sandbox: workspace.kind === "sandbox",
    now: nowFor(workspace),
  };
}

async function guard<T>(fn: () => Promise<T>): Promise<FactoryResult<T>> {
  try {
    const value = await fn();
    revalidatePath("/factory", "layout");
    return { ok: true, value };
  } catch (err) {
    if (err instanceof FactoryError || err instanceof GenError)
      return { ok: false, error: err.message };
    if (err instanceof TokenKeyError) {
      return {
        ok: false,
        error:
          "TOKEN_ENC_KEY isn't set on the server, so keys can't be stored. Add it in Vercel first.",
      };
    }
    console.error("Factory settings failed:", err);
    return { ok: false, error: "That didn't work. Try again." };
  }
}

export async function saveKey(provider: unknown, key: unknown) {
  return guard(async () => {
    if (!isKeyProvider(provider)) throw new FactoryError("bad_provider", "Unknown provider.");
    if (typeof key !== "string") throw new FactoryError("bad_key", "Paste the key.");
    const saved = await saveGenKey(await gen(), provider, key);
    return `Saved the key ending ${saved.last4}.`;
  });
}

export async function testKey(provider: unknown) {
  return guard(async () => {
    if (!isKeyProvider(provider)) throw new FactoryError("bad_provider", "Unknown provider.");
    const result = await testGenKey(await gen(), provider);
    return result.testMessage ?? "";
  });
}

export async function removeKey(provider: unknown) {
  return guard(async () => {
    if (!isKeyProvider(provider)) throw new FactoryError("bad_provider", "Unknown provider.");
    const ctx = await gen();
    await deleteGenKey(ctx, provider);
    // That provider's models can't run without the key.
    const s = await ctx.db
      .from("factory_settings")
      .select("enabled_models, default_face_model, fallback_face_model")
      .eq("workspace_id", ctx.workspaceId)
      .single();
    if (s.error) fail("reading the settings", s.error);
    const ofProvider = (k: string | null) => Boolean(k && faceModel(k)?.provider === provider);
    const { error } = await ctx.db
      .from("factory_settings")
      .update({
        enabled_models: s.data.enabled_models.filter((k) => !ofProvider(k)),
        default_face_model: ofProvider(s.data.default_face_model)
          ? "placeholder"
          : s.data.default_face_model,
        fallback_face_model: ofProvider(s.data.fallback_face_model)
          ? null
          : s.data.fallback_face_model,
      })
      .eq("workspace_id", ctx.workspaceId);
    if (error) fail("saving the settings", error);
    return "Key removed.";
  });
}

export interface ModelSettings {
  enabled: string[];
  defaultModel: string;
  fallbackModel: string | null;
}

export async function saveModels(input: ModelSettings) {
  return guard(async () => {
    const ctx = await gen();
    const raw = input as unknown as Record<string, unknown> | null;
    const enabled = Array.isArray(raw?.enabled)
      ? raw.enabled.filter((k): k is string => typeof k === "string")
      : [];
    const keys = await ctx.db
      .from("gen_keys")
      .select("provider")
      .eq("workspace_id", ctx.workspaceId);
    if (keys.error) fail("reading the keys", keys.error);
    const withKey = new Set(keys.data.map((k) => k.provider));
    for (const k of enabled) {
      const m = faceModel(k);
      if (!m || !isSelectable(m)) {
        throw new FactoryError(
          "bad_model",
          `${m?.label ?? k} can't be enabled (planned: no adapter yet).`,
        );
      }
      if (!isFree(m) && !ctx.sandbox && !withKey.has(m.provider)) {
        throw new FactoryError("no_key", `Save a ${m.provider} key before enabling ${m.label}.`);
      }
    }
    const list = [...new Set(["placeholder", ...enabled])];
    const def = typeof raw?.defaultModel === "string" ? raw.defaultModel : "placeholder";
    const fb =
      typeof raw?.fallbackModel === "string" && raw.fallbackModel ? raw.fallbackModel : null;
    if (!list.includes(def))
      throw new FactoryError("bad_default", "The default model must be enabled.");
    if (fb && !list.includes(fb))
      throw new FactoryError("bad_fallback", "The fallback model must be enabled.");
    const { error } = await ctx.db
      .from("factory_settings")
      .update({ enabled_models: list, default_face_model: def, fallback_face_model: fb })
      .eq("workspace_id", ctx.workspaceId);
    if (error) fail("saving the models", error);
    return "Face model settings saved.";
  });
}

export async function saveCaps(perVideo: unknown, monthly: unknown) {
  return guard(async () => {
    const v = Number(perVideo);
    const m = Number(monthly);
    if (!Number.isFinite(v) || v < 0 || v > 1000) {
      throw new FactoryError("bad_cap", "The per-video cap is a dollar amount from 0 to 1000.");
    }
    if (!Number.isFinite(m) || m < 0 || m > 10000) {
      throw new FactoryError("bad_cap", "The monthly cap is a dollar amount from 0 to 10000.");
    }
    const ctx = await gen();
    const { error } = await ctx.db
      .from("factory_settings")
      .update({
        cap_per_video_usd: Math.round(v * 100) / 100,
        cap_monthly_usd: Math.round(m * 100) / 100,
      })
      .eq("workspace_id", ctx.workspaceId);
    if (error) fail("saving the caps", error);
    return `Caps saved: $${v.toFixed(2)} a video, $${m.toFixed(2)} a month.`;
  });
}

export async function saveDefaultModes(modes: Record<string, unknown>) {
  return guard(async () => {
    const raw = (modes as Record<string, unknown> | null) ?? {};
    for (const k of Object.keys(raw))
      if (!isStep(k)) throw new FactoryError("bad_step", "Unknown step.");
    const out: Record<string, string> = {};
    for (const step of ALL_STEPS) {
      const v = raw[step];
      if (v === "auto" || v === "wait") out[step] = v;
    }
    const ctx = await gen();
    const { error } = await ctx.db
      .from("factory_settings")
      .update({ step_modes: out })
      .eq("workspace_id", ctx.workspaceId);
    if (error) fail("saving the modes", error);
    return "Default approval modes saved.";
  });
}

/** 3D models for hero assets (BC-30): enabled, default and fallback. */
export async function saveMeshModels(input: ModelSettings) {
  return guard(async () => {
    const { meshModel, isMeshSelectable } = await import("@/lib/domain/factory/mesh");
    const ctx = await gen();
    const raw = input as unknown as Record<string, unknown> | null;
    const enabled = Array.isArray(raw?.enabled)
      ? raw.enabled.filter((k): k is string => typeof k === "string")
      : [];
    const keys = await ctx.db
      .from("gen_keys")
      .select("provider")
      .eq("workspace_id", ctx.workspaceId);
    if (keys.error) fail("reading the keys", keys.error);
    const withKey = new Set(keys.data.map((k) => k.provider));
    for (const k of enabled) {
      const m = meshModel(k);
      if (!m || !isMeshSelectable(m)) throw new FactoryError("bad_model", `${k} can't be enabled.`);
      if (m.priceUsd > 0 && !ctx.sandbox && !withKey.has(m.provider)) {
        throw new FactoryError("no_key", `Save a ${m.provider} key before enabling ${m.label}.`);
      }
    }
    const list = [...new Set(["placeholder", ...enabled])];
    const def = typeof raw?.defaultModel === "string" ? raw.defaultModel : "placeholder";
    const fb =
      typeof raw?.fallbackModel === "string" && raw.fallbackModel ? raw.fallbackModel : null;
    if (!list.includes(def))
      throw new FactoryError("bad_default", "The default 3D model must be enabled.");
    if (fb && !list.includes(fb))
      throw new FactoryError("bad_fallback", "The fallback 3D model must be enabled.");
    const { error } = await ctx.db
      .from("factory_settings")
      .update({ enabled_mesh_models: list, default_mesh_model: def, fallback_mesh_model: fb })
      .eq("workspace_id", ctx.workspaceId);
    if (error) fail("saving the 3D models", error);
    return "3D model settings saved.";
  });
}
