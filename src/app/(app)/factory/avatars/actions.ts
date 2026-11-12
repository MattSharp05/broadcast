"use server";

import { revalidatePath } from "next/cache";
import { nowFor } from "@/lib/clock";
import { createAdminSupabase } from "@/lib/db/admin";
import { isSignedInOwner } from "@/lib/db/auth";
import {
  FactoryError,
  fail,
  getAvatar,
  loadFactorySettings,
  spendSoFar,
  type Db,
} from "@/lib/db/factory";
import type { Json } from "@/lib/db/types";
import { currentWorkspace } from "@/lib/db/workspace";
import {
  STUDIO_STEPS,
  assembleProfile,
  fakeCandidates,
  isPaidStudioStep,
  needsNewVersion,
  nextStudioStep,
  stepPicked,
  studioEstimate,
  validFaceModelKey,
  type Studio,
  type StudioStep,
} from "@/lib/domain/factory/avatar";
import { checkBudget } from "@/lib/domain/factory/budget";
import { assetPath, signAssetUpload, toRef } from "@/lib/factory/assets";
import type { FactoryResult } from "../actions";

/** The Avatar studio's actions (one avatar per account; references/avatar-profile.md). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Ctx {
  db: Db;
  ws: string;
  sandbox: boolean;
  now: Date;
}

async function context(): Promise<Ctx> {
  if (!(await isSignedInOwner())) throw new FactoryError("signed_out", "Sign in again.");
  const w = await currentWorkspace();
  return { db: createAdminSupabase(), ws: w.id, sandbox: w.kind === "sandbox", now: nowFor(w) };
}

async function guard<T>(fn: () => Promise<T>): Promise<FactoryResult<T>> {
  try {
    const value = await fn();
    revalidatePath("/factory", "layout");
    return { ok: true, value };
  } catch (err) {
    if (err instanceof FactoryError) return { ok: false, error: err.message };
    console.error("Avatar studio failed:", err);
    return { ok: false, error: "That didn't work. Try again." };
  }
}

function id(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new FactoryError("bad_id", "Unknown avatar.");
  return v;
}

function isStudioStep(v: unknown): v is Exclude<StudioStep, "done"> {
  return typeof v === "string" && (STUDIO_STEPS as readonly string[]).includes(v);
}

async function load(ctx: Ctx, avatarId: string) {
  const a = await getAvatar(ctx.db, ctx.ws, avatarId);
  if (!a) throw new FactoryError("not_found", "That avatar doesn't exist in this workspace.");
  return { ...a, studioData: a.studio as unknown as Studio };
}

async function saveStudio(
  ctx: Ctx,
  avatarId: string,
  studio: Studio,
  extra: Record<string, unknown> = {},
) {
  const { error } = await ctx.db
    .from("avatars")
    .update({ studio: studio as unknown as NonNullable<Json>, ...extra })
    .eq("workspace_id", ctx.ws)
    .eq("id", avatarId);
  if (error) fail("saving the studio", error);
}

export async function createAvatar(input: { name: unknown; accountId: unknown }) {
  return guard(async () => {
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 40) : "";
    if (!name) throw new FactoryError("no_name", "Give the avatar a name.");
    const ctx = await context();
    const accountId = input.accountId ? id(input.accountId) : null;
    if (accountId) {
      const taken = await ctx.db
        .from("avatars")
        .select("name")
        .eq("workspace_id", ctx.ws)
        .eq("account_id", accountId)
        .maybeSingle();
      if (taken.data)
        throw new FactoryError(
          "taken",
          `That account already has an avatar (${taken.data.name}). One avatar per account.`,
        );
    }
    const { data, error } = await ctx.db
      .from("avatars")
      .insert({
        workspace_id: ctx.ws,
        name,
        account_id: accountId,
        profile: { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), identity: { name } },
      })
      .select("id")
      .single();
    if (error) fail("creating the avatar", error);
    return data.id;
  });
}

/** Runs a studio step: the fake runner in the Sandbox; Live generation needs an image adapter. */
export async function runStudioStep(avatarId: unknown, step: unknown) {
  return guard(async () => {
    const aid = id(avatarId);
    if (!isStudioStep(step)) throw new FactoryError("bad_step", "Unknown step.");
    const ctx = await context();
    const a = await load(ctx, aid);
    const settings = await loadFactorySettings(ctx.db, ctx.ws);
    const models = { primary: settings.defaultFaceModel, fallback: settings.fallbackFaceModel };

    if (step === "voice") {
      // Free: the library's voices, every workspace.
      const voices = await ctx.db
        .from("factory_voices")
        .select("key, label, sample_url")
        .eq("paid", false)
        .order("sort");
      if (voices.error) fail("reading the voices", voices.error);
      await saveStudio(ctx, aid, { ...a.studioData, voices: voices.data.slice(0, 3) });
      return "Voices ready: play them and pick one.";
    }
    if (!ctx.sandbox) {
      throw new FactoryError(
        "live_generation",
        step === "persona"
          ? "Persona drafts by Claude aren't wired up for Live yet. Write the persona in the profile below."
          : "Live image and screen-test generation needs an image-model adapter that isn't built yet. Upload the image instead.",
      );
    }
    const quote = studioEstimate(step, models);
    if (isPaidStudioStep(step) && quote > 0) {
      const spend = await spendSoFar(ctx.db, ctx.ws, null, ctx.now);
      const check = checkBudget(
        quote,
        { videoUsd: 0, monthUsd: spend.monthUsd },
        { perVideoUsd: Number.POSITIVE_INFINITY, monthlyUsd: settings.caps.monthlyUsd },
      );
      if (!check.ok)
        throw new FactoryError(
          "budget",
          `This step (~$${quote.toFixed(2)}) would pass the monthly cap. $${check.remainingUsd.toFixed(2)} is left.`,
        );
      // The Sandbox's fake provider: logged at the estimate, like a real run.
      const { error } = await ctx.db.from("gen_jobs").insert({
        workspace_id: ctx.ws,
        avatar_id: aid,
        kind: step === "screen_test" ? "face" : "image",
        slot: `studio-${step}`,
        model: step === "screen_test" ? models.primary : "image-estimate",
        provider: "fake",
        idempotency_key: `studio:${aid}:${step}:${Date.now()}`,
        seconds: step === "screen_test" ? 10 : 1,
        quote_usd: quote,
        cost_usd: quote,
        status: "completed",
        completed_at: ctx.now.toISOString(),
      });
      if (error) fail("logging the cost", error);
    }
    const voices: Studio["voices"] = [];
    const candidates = fakeCandidates(step, { name: a.name, voices, models });
    await saveStudio(ctx, aid, { ...a.studioData, ...candidates });
    return quote > 0 ? `Done (Sandbox): ~$${quote.toFixed(2)} logged.` : "Done (Sandbox).";
  });
}

export async function pickCandidate(avatarId: unknown, step: unknown, value: unknown) {
  return guard(async () => {
    const aid = id(avatarId);
    if (!isStudioStep(step) || typeof value !== "string")
      throw new FactoryError("bad_pick", "Unknown choice.");
    const ctx = await context();
    const a = await load(ctx, aid);
    const s = { ...a.studioData };
    if (step === "persona") s.persona_pick = value;
    if (step === "portrait") s.portrait_pick = value;
    if (step === "voice") s.voice_pick = value;
    if (step === "screen_test") s.screen_pick = value;
    if (step === "face_pack") {
      const [cid, status] = value.split(":");
      s.face_pack = (s.face_pack ?? []).map((c) =>
        c.id === cid && (status === "approved" || status === "rejected") ? { ...c, status } : c,
      );
    }
    await saveStudio(ctx, aid, s);
    return null;
  });
}

/** Moves to the next step; the last one saves the profile as version 1. */
export async function advanceStudio(avatarId: unknown) {
  return guard(async () => {
    const aid = id(avatarId);
    const ctx = await context();
    const a = await load(ctx, aid);
    const step = a.studio_step as StudioStep;
    if (step === "done") throw new FactoryError("done", "The avatar is already saved.");
    const missing = stepPicked(step, a.studioData);
    if (missing) throw new FactoryError("missing", missing);
    const next = nextStudioStep(step);
    if (next !== "done") {
      await saveStudio(ctx, aid, a.studioData, { studio_step: next });
      return "Next step.";
    }
    const account = a.account_id
      ? await ctx.db.from("social_accounts").select("handle").eq("id", a.account_id).maybeSingle()
      : { data: null };
    const version = a.current_version + 1;
    const profile = assembleProfile({
      base: a.profile as Record<string, unknown>,
      studio: a.studioData,
      account: account.data ? `@${account.data.handle}` : null,
      version,
      capUsd: null,
    });
    const ins = await ctx.db.from("avatar_versions").insert({
      workspace_id: ctx.ws,
      avatar_id: aid,
      version,
      profile: profile as NonNullable<Json>,
      note: "Screen test approved.",
    });
    if (ins.error) fail("saving the version", ins.error);
    await saveStudio(ctx, aid, a.studioData, {
      studio_step: "done",
      current_version: version,
      profile: profile,
    });
    return `Saved ${a.name} as v${version}.`;
  });
}

/** A signed upload for a portrait or face-pack image (Live: until an image adapter exists). */
export async function avatarUpload(avatarId: unknown, contentType: unknown) {
  return guard(async () => {
    const aid = id(avatarId);
    if (contentType !== "image/jpeg" && contentType !== "image/png")
      throw new FactoryError("bad_type", "Upload a JPEG or PNG.");
    const ctx = await context();
    await load(ctx, aid);
    const ref = assetPath(ctx.ws, aid, contentType);
    if (!ref) throw new FactoryError("bad_type", "Upload a JPEG or PNG.");
    return { uploadUrl: await signAssetUpload(ctx.db, ref), ref: toRef(ref) };
  });
}

export async function addUploadedCandidate(
  avatarId: unknown,
  step: unknown,
  ref: unknown,
  label: unknown,
) {
  return guard(async () => {
    const aid = id(avatarId);
    if ((step !== "portrait" && step !== "face_pack") || typeof ref !== "string")
      throw new FactoryError("bad_upload", "Unknown upload.");
    const ctx = await context();
    if (!ref.startsWith(`storage:factory/${ctx.ws}/${aid}/`))
      throw new FactoryError("bad_upload", "Unknown upload.");
    const a = await load(ctx, aid);
    const s = { ...a.studioData };
    const name = typeof label === "string" && label.trim() ? label.trim().slice(0, 40) : "Upload";
    const cid = `u${Date.now()}`;
    if (step === "portrait")
      s.portraits = [...(s.portraits ?? []), { id: cid, url: ref, label: name }];
    else
      s.face_pack = [...(s.face_pack ?? []), { id: cid, url: ref, label: name, status: "pending" }];
    await saveStudio(ctx, aid, s);
    return null;
  });
}

export interface ProfileEdit {
  name?: string;
  accountId?: string | null;
  backstory?: string;
  tone?: string;
  faceModel?: string | null;
  fallbackModel?: string | null;
  seed?: number | null;
  resolution?: string;
  capUsd?: number | null;
  notes?: string;
  voiceKey?: string | null;
}

/** Saves profile edits. A change to the look or the voice makes a new version. */
export async function saveProfile(avatarId: unknown, edit: ProfileEdit) {
  return guard(async () => {
    const aid = id(avatarId);
    const ctx = await context();
    const a = await load(ctx, aid);
    const raw = (edit as unknown as Record<string, unknown> | null) ?? {};
    const before = a.profile as Record<string, Record<string, unknown> | undefined> &
      Record<string, unknown>;
    const gen = { ...(before.generation ?? {}) };
    if ("faceModel" in raw) {
      if (raw.faceModel !== null && !validFaceModelKey(raw.faceModel))
        throw new FactoryError("bad_model", "Unknown face model.");
      gen.face_model = raw.faceModel;
    }
    if ("fallbackModel" in raw) {
      if (raw.fallbackModel !== null && !validFaceModelKey(raw.fallbackModel))
        throw new FactoryError("bad_model", "Unknown fallback model.");
      gen.fallback_model = raw.fallbackModel;
    }
    if ("seed" in raw)
      gen.seed = typeof raw.seed === "number" && Number.isInteger(raw.seed) ? raw.seed : null;
    if (typeof raw.resolution === "string")
      gen.resolution = raw.resolution === "1080p" ? "1080p" : "720p";
    if ("capUsd" in raw) {
      const cap = raw.capUsd;
      if (cap !== null && (typeof cap !== "number" || cap < 0 || cap > 1000))
        throw new FactoryError("bad_cap", "The avatar's cap is a dollar amount from 0 to 1000.");
      gen.cost_cap_per_video_usd = cap;
    }
    const after: Record<string, unknown> = {
      ...before,
      identity: {
        ...(before.identity ?? {}),
        ...(typeof raw.backstory === "string" ? { backstory: raw.backstory.slice(0, 2000) } : {}),
        ...(typeof raw.name === "string" && raw.name.trim() ? { name: raw.name.trim() } : {}),
      },
      personality: {
        ...(before.personality ?? {}),
        ...(typeof raw.tone === "string" ? { tone: raw.tone.slice(0, 200) } : {}),
      },
      voice: {
        ...(before.voice ?? {}),
        ...(typeof raw.voiceKey === "string" ? { provider: "qwen", voice_id: raw.voiceKey } : {}),
      },
      generation: gen,
      ...(typeof raw.notes === "string" ? { notes: raw.notes.slice(0, 4000) } : {}),
    };
    const update: {
      name?: string;
      account_id?: string | null;
      current_version?: number;
      profile?: NonNullable<Json>;
    } = {};
    if (typeof raw.name === "string" && raw.name.trim()) update.name = raw.name.trim().slice(0, 40);
    if (raw.accountId === null || typeof raw.accountId === "string") {
      const acc = raw.accountId === null ? null : id(raw.accountId);
      if (acc) {
        const taken = await ctx.db
          .from("avatars")
          .select("id")
          .eq("workspace_id", ctx.ws)
          .eq("account_id", acc)
          .neq("id", aid)
          .maybeSingle();
        if (taken.data)
          throw new FactoryError(
            "taken",
            "That account already has an avatar. One avatar per account.",
          );
      }
      update.account_id = acc;
    }
    let message = "Saved.";
    if (a.current_version >= 1 && needsNewVersion(before, after)) {
      const version = a.current_version + 1;
      after.version = version;
      const ins = await ctx.db.from("avatar_versions").insert({
        workspace_id: ctx.ws,
        avatar_id: aid,
        version,
        profile: after as NonNullable<Json>,
        note: "Look or voice changed.",
      });
      if (ins.error) fail("saving the version", ins.error);
      update.current_version = version;
      message = `Saved as v${version}: the voice or look changed. Videos made with v${a.current_version} keep it in their recipe.`;
    } else if (a.current_version >= 1) {
      const upd = await ctx.db
        .from("avatar_versions")
        .update({ profile: after as NonNullable<Json> })
        .eq("avatar_id", aid)
        .eq("version", a.current_version);
      if (upd.error) fail("saving the version", upd.error);
    }
    update.profile = after as NonNullable<Json>;
    const { error } = await ctx.db
      .from("avatars")
      .update(update)
      .eq("workspace_id", ctx.ws)
      .eq("id", aid);
    if (error) fail("saving the avatar", error);
    return message;
  });
}

export async function setStudioMode(avatarId: unknown, step: unknown, mode: unknown) {
  return guard(async () => {
    const aid = id(avatarId);
    if (!isStudioStep(step) || (mode !== "wait" && mode !== "auto"))
      throw new FactoryError("bad_mode", "Unknown step.");
    const ctx = await context();
    const a = await load(ctx, aid);
    await saveStudio(ctx, aid, {
      ...a.studioData,
      modes: { ...(a.studioData.modes ?? {}), [step]: mode },
    });
    return null;
  });
}

/** The account's AI disclosure checklist: Instagram's AI label and the "AI creator" bio line. */
export async function setDisclosure(accountId: unknown, field: unknown, done: unknown) {
  return guard(async () => {
    const acc = id(accountId);
    if ((field !== "label" && field !== "bio") || typeof done !== "boolean")
      throw new FactoryError("bad_field", "Unknown checklist item.");
    const ctx = await context();
    const { error } = await ctx.db
      .from("social_accounts")
      .update(field === "label" ? { ai_label_done: done } : { ai_bio_done: done })
      .eq("workspace_id", ctx.ws)
      .eq("id", acc);
    if (error) fail("saving the checklist", error);
    return null;
  });
}
