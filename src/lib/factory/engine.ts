import "server-only";
import { configuredAppOrigin } from "@/lib/app-url";
import {
  FACTORY_TOKEN_TTL_MS,
  generateFactoryToken,
  hashFactoryToken,
} from "@/lib/auth/factory-tokens";
import {
  FactoryError,
  avatarCap,
  avatarGeneration,
  fail,
  getAvatar,
  getProduction,
  getSteps,
  loadFactorySettings,
  spendSoFar,
  updateProduction,
  updateStep,
  type Db,
  type ProductionRow,
  type StepRow,
} from "@/lib/db/factory";
import type { Json } from "@/lib/db/types";
import { workspaceKindOf } from "@/lib/db/workspaces";
import { capsFor, checkBudget } from "@/lib/domain/factory/budget";
import { creditLines, draftCaptions } from "@/lib/domain/factory/captions";
import {
  FAKE_SLOTS,
  fakeOutput,
  type QuoteOutput,
  type RenderOutput,
  type ScriptOutput,
} from "@/lib/domain/factory/fake-outputs";
import { resolveFaceModel } from "@/lib/domain/factory/models";
import { buildRecipe } from "@/lib/domain/factory/recipe";
import { reworkStep, type ReworkTarget } from "@/lib/domain/factory/rework";
import {
  decideCheckpoint,
  modeFor,
  nextStep,
  parseModes,
  productionStatus,
  stepsFor,
  type FactoryStep,
  type ProductionStatus,
} from "@/lib/domain/factory/steps";
import { submitFaceJob } from "./gen";
import { fireRoutine, type FireResult } from "./runner";

/**
 * The production engine: starts steps, records checkpoints, applies "Wait for me" / "Autopilot",
 * approves and reruns. Used by the dashboard (server actions), the factory API (sessions) and
 * the fake runner. Service-role client; every query is scoped by the workspace id.
 */

export interface EngineContext {
  db: Db;
  workspaceId: string;
  now: Date;
  /** Origin sessions call back (APP_URL); the request's origin when unset. */
  appUrl?: string;
}

export type StartOutcome =
  | { kind: "fake" }
  | { kind: "session"; sessionUrl: string }
  | { kind: "manual"; prompt: string; reason: string }
  | { kind: "error"; message: string };

function sandbox(ctx: EngineContext): boolean {
  return workspaceKindOf(ctx.workspaceId) === "sandbox";
}

/** Everything a production needs before its first step can run; the message says what's missing. */
export function missingForStart(p: ProductionRow): string | null {
  if (!p.idea.trim()) return "Write the idea first.";
  if (!p.style) return "Pick a style.";
  if (p.use_avatar && !p.avatar_id) return "Pick an avatar, or switch the UGC avatar off.";
  if (!p.voice_key) return "Pick a voice.";
  if (!p.music_key) return "Pick a music track.";
  return null;
}

export async function createProduction(
  ctx: EngineContext,
  input: { idea?: string; title?: string; remakeOf?: string | null; accountId?: string | null },
): Promise<string> {
  let base: Partial<ProductionRow> = {};
  if (input.remakeOf) {
    const src = await getProduction(ctx.db, ctx.workspaceId, input.remakeOf);
    // A remake keeps the idea and the style; wording, hook, voice and look are made new.
    base = { idea: src.idea, style: src.style, music_key: src.music_key, title: src.title };
  }
  const { data, error } = await ctx.db
    .from("productions")
    .insert({
      workspace_id: ctx.workspaceId,
      idea: input.idea ?? base.idea ?? "",
      title: input.title ?? (base.title ? `${base.title} (remake)` : ""),
      style: base.style ?? null,
      music_key: base.music_key ?? null,
      remake_of: input.remakeOf ?? null,
      account_id: input.accountId ?? null,
    })
    .select("id")
    .single();
  if (error) fail("creating the video", error);
  return data.id;
}

export async function startProduction(ctx: EngineContext, id: string): Promise<StartOutcome> {
  const p = await getProduction(ctx.db, ctx.workspaceId, id);
  if (p.status !== "draft") throw new FactoryError("started", "This video has already started.");
  const missing = missingForStart(p);
  if (missing) throw new FactoryError("incomplete", missing);

  let avatarVersion: number | null = null;
  if (p.use_avatar && p.avatar_id) {
    const avatar = await getAvatar(ctx.db, ctx.workspaceId, p.avatar_id);
    if (!avatar || avatar.current_version < 1) {
      throw new FactoryError(
        "avatar_draft",
        "That avatar has no saved version yet. Finish it in the Avatar studio.",
      );
    }
    avatarVersion = avatar.current_version;
  }

  const rows = stepsFor(p.use_avatar).map((step) => ({
    workspace_id: ctx.workspaceId,
    production_id: id,
    step,
  }));
  const { error } = await ctx.db.from("production_steps").upsert(rows);
  if (error) fail("creating the steps", error);
  await updateProduction(ctx.db, ctx.workspaceId, id, {
    status: "running",
    avatar_version: avatarVersion,
    project_slug: p.project_slug ?? slugFor(p),
  });
  return fireStep(ctx, id, "idea", null);
}

function slugFor(p: ProductionRow): string {
  const base = (p.title || p.idea)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "video"}-${p.id.slice(0, 6)}`;
}

/** Mints a factory token for one production (only its hash is stored). */
export async function mintFactoryToken(ctx: EngineContext, productionId: string): Promise<string> {
  const token = generateFactoryToken(workspaceKindOf(ctx.workspaceId));
  const { error } = await ctx.db.from("factory_tokens").insert({
    workspace_id: ctx.workspaceId,
    production_id: productionId,
    token_hash: hashFactoryToken(token),
    // Real time, never the Sandbox clock: the session runs now.
    expires_at: new Date(Date.now() + FACTORY_TOKEN_TTL_MS).toISOString(),
  });
  if (error) fail("saving the session token", error);
  return token;
}

/** Runs one step: the fake runner in the Sandbox, else a routine fire (or a prompt to paste). */
export async function fireStep(
  ctx: EngineContext,
  id: string,
  step: FactoryStep,
  note: string | null,
): Promise<StartOutcome> {
  const ws = ctx.workspaceId;
  const steps = await getSteps(ctx.db, ws, id);
  const row = steps.find((s) => s.step === step);
  if (!row) throw new FactoryError("no_step", "That step isn't part of this video.");
  await updateStep(ctx.db, ws, id, step, {
    status: "running",
    progress: 0,
    message: note ? `Redo: ${note}` : null,
    attempt: row.attempt + 1,
    started_at: ctx.now.toISOString(),
    finished_at: null,
  });
  await refreshStatus(ctx, id);

  if (sandbox(ctx)) {
    await runFake(ctx, id, step, row.attempt);
    return { kind: "fake" };
  }

  const token = await mintFactoryToken(ctx, id);
  const appUrl = ctx.appUrl ?? configuredAppOrigin() ?? "http://localhost:3000";
  const result: FireResult = await fireRoutine({ productionId: id, step, appUrl, token, note });
  if (result.kind === "session") {
    await updateStep(ctx.db, ws, id, step, {
      session_id: result.sessionId,
      session_url: result.sessionUrl,
      message: "A Claude session is working on this.",
    });
    await updateProduction(ctx.db, ws, id, {
      session_id: result.sessionId,
      session_url: result.sessionUrl,
    });
    return { kind: "session", sessionUrl: result.sessionUrl };
  }
  if (result.kind === "manual") {
    await updateStep(ctx.db, ws, id, step, {
      message: "Waiting for a Claude session. Copy the prompt into a new session on video-editor.",
    });
    return result;
  }
  await updateStep(ctx.db, ws, id, step, { status: "failed", message: result.message });
  await refreshStatus(ctx, id);
  return result;
}

/** The fake runner: what a session would post, at once (Sandbox, scenarios, e2e). */
async function runFake(ctx: EngineContext, id: string, step: FactoryStep, attempt: number) {
  const p = await getProduction(ctx.db, ctx.workspaceId, id);
  const faceModel = await faceModelFor(ctx, p);
  const script = p.script as { version?: number } | null;
  const output = fakeOutput(step, {
    idea: p.idea,
    style: p.style,
    useAvatar: p.use_avatar,
    faceModel,
    scriptVersion: script?.version ?? 0,
    attempt,
  });
  if (step === "render" && p.use_avatar) {
    // The avatar clips go through the real proxy logic (fake provider): kept clips are reused.
    for (const s of FAKE_SLOTS) {
      try {
        await submitFaceJob(
          { db: ctx.db, workspaceId: ctx.workspaceId, sandbox: true, now: ctx.now },
          {
            productionId: id,
            slot: s.slot,
            model: faceModel,
            // Changes with every render (new audio after a voice rework), like gen_face.py's key.
            idempotencyKey: `fake:${id}:${s.slot}:render${attempt + 1}`,
            image: "fake://master.png",
            audio: `fake://audio-${attempt + 1}.wav`,
            seconds: s.seconds,
          },
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await updateStep(ctx.db, ctx.workspaceId, id, step, { status: "failed", message });
        await refreshStatus(ctx, id);
        return;
      }
    }
  }
  await recordCheckpoint(ctx, id, step, output as unknown as Json);
}

export async function faceModelFor(ctx: EngineContext, p: ProductionRow): Promise<string> {
  const settings = await loadFactorySettings(ctx.db, ctx.workspaceId);
  const avatar = p.avatar_id ? await getAvatar(ctx.db, ctx.workspaceId, p.avatar_id) : null;
  let account: string | null = null;
  if (p.account_id) {
    const { data } = await ctx.db
      .from("social_accounts")
      .select("face_model")
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", p.account_id)
      .maybeSingle();
    account = data?.face_model ?? null;
  }
  return resolveFaceModel({
    video: p.face_model,
    avatar: avatarGeneration(avatar).faceModel,
    account,
    workspaceDefault: settings.defaultFaceModel,
    enabled: [...settings.enabledModels, "placeholder"],
  }).key;
}

export async function recordProgress(
  ctx: EngineContext,
  id: string,
  step: FactoryStep,
  progress: number,
  message: string | null,
): Promise<void> {
  await updateStep(ctx.db, ctx.workspaceId, id, step, {
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    message,
  });
}

/**
 * A step's output arrived (from a session or the fake runner). It waits for Matthew, or is
 * approved at once on autopilot (a paid step only when its quote fits under the caps).
 */
export async function recordCheckpoint(
  ctx: EngineContext,
  id: string,
  step: FactoryStep,
  output: Json,
  extra: { mediaId?: string | null } = {},
): Promise<void> {
  const ws = ctx.workspaceId;
  const p = await getProduction(ctx.db, ws, id);
  const out = (output ?? {}) as Record<string, unknown>;

  if (step === "idea" && !p.title && typeof out.title === "string") {
    await updateProduction(ctx.db, ws, id, { title: out.title.slice(0, 120) });
  }
  if (step === "script") {
    const s = out as unknown as ScriptOutput;
    await updateProduction(ctx.db, ws, id, {
      script: { version: s.version, hook: s.hook, lines: s.lines } as unknown as Json,
    });
  }
  if (step === "render") {
    const mediaId = extra.mediaId ?? (sandbox(ctx) ? await fakeMedia(ctx, p) : null);
    if (mediaId) {
      await attachRender(ctx, p, mediaId, out);
      out.media_id = mediaId;
    }
  }

  await updateStep(ctx.db, ws, id, step, {
    status: "waiting",
    progress: 100,
    output: out as NonNullable<Json>,
    finished_at: ctx.now.toISOString(),
    message: null,
  });

  const settings = await loadFactorySettings(ctx.db, ws);
  const mode = modeFor(step, parseModes(p.step_modes), settings.stepModes);
  let quoteUsd: number | undefined;
  let remainingUsd: number | undefined;
  if (step === "face_quote") {
    quoteUsd = (out as unknown as Partial<QuoteOutput>).quote?.totalUsd ?? 0;
    const avatar = p.avatar_id ? await getAvatar(ctx.db, ws, p.avatar_id) : null;
    const spend = await spendSoFar(ctx.db, ws, id, ctx.now);
    remainingUsd = checkBudget(0, spend, capsFor(settings.caps, avatarCap(avatar))).remainingUsd;
  }
  const decision = decideCheckpoint({ step, mode, quoteUsd, remainingUsd });
  if (decision.approve) {
    await approveStep(ctx, id, step, { auto: true });
    return;
  }
  if (decision.reason === "over_cap") {
    await updateStep(ctx.db, ws, id, step, { message: decision.message });
  }
  await refreshStatus(ctx, id);
}

async function fakeMedia(ctx: EngineContext, p: ProductionRow): Promise<string> {
  const steps = await getSteps(ctx.db, ctx.workspaceId, p.id);
  const attempt = steps.find((s) => s.step === "render")?.attempt ?? 1;
  const { data, error } = await ctx.db
    .from("media_assets")
    .insert({
      workspace_id: ctx.workspaceId,
      storage_path: `${ctx.workspaceId}/videos/factory-${p.id}-r${attempt}.mp4`,
      duration_s: 60,
      width: 1080,
      height: 1920,
      bytes: 12_000_000,
    })
    .select("id")
    .single();
  if (error) fail("saving the fake render", error);
  return data.id;
}

/** Links the render to the video, writes its recipe, and drafts captions with the credits. */
async function attachRender(
  ctx: EngineContext,
  p: ProductionRow,
  mediaId: string,
  render: Partial<RenderOutput>,
): Promise<void> {
  const ws = ctx.workspaceId;
  const [avatar, voice, music, spend] = await Promise.all([
    p.avatar_id ? getAvatar(ctx.db, ws, p.avatar_id) : Promise.resolve(null),
    p.voice_key
      ? ctx.db.from("factory_voices").select("key, credit").eq("key", p.voice_key).maybeSingle()
      : Promise.resolve({ data: null }),
    p.music_key
      ? ctx.db
          .from("factory_music")
          .select("key, credit, licence")
          .eq("key", p.music_key)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    spendSoFar(ctx.db, ws, p.id, ctx.now),
  ]);
  const script = p.script as { version?: number; hook?: string } | null;
  const recipe = buildRecipe({
    productionId: p.id,
    style: p.style,
    avatarName: p.use_avatar ? (avatar?.name ?? null) : null,
    avatarVersion: p.avatar_version,
    faceModel: p.use_avatar ? await faceModelFor(ctx, p) : null,
    faceShare: render.face_share ?? null,
    voice: p.voice_key,
    music: p.music_key,
    hook: script?.hook ?? null,
    scriptVersion: script?.version ?? null,
    series: null,
    costUsd: spend.videoUsd,
  });
  const { error } = await ctx.db
    .from("media_assets")
    .update({ recipe: recipe as unknown as Json })
    .eq("workspace_id", ws)
    .eq("id", mediaId);
  if (error) fail("saving the recipe", error);

  // The previous render goes when nothing posted it.
  if (p.media_id && p.media_id !== mediaId && !p.post_id) {
    await ctx.db.from("media_assets").delete().eq("workspace_id", ws).eq("id", p.media_id);
  }
  const credits = creditLines({
    musicCredit: music.data?.credit ?? null,
    musicLicence: music.data?.licence ?? null,
    voiceCredit: voice.data?.credit ?? null,
    avatar: p.use_avatar,
    imagery: render.imagery_credits ?? [],
  });
  const options =
    Array.isArray(p.caption_options) && p.caption_options.length
      ? p.caption_options
      : draftCaptions({ title: p.title, idea: p.idea, hook: script?.hook ?? null, credits });
  await updateProduction(ctx.db, ws, p.id, {
    media_id: mediaId,
    caption_options: options,
    caption: p.caption ?? (typeof options[0] === "string" ? options[0] : null),
  });
}

export async function approveStep(
  ctx: EngineContext,
  id: string,
  step: FactoryStep,
  opts: { auto?: boolean } = {},
): Promise<StartOutcome | null> {
  const ws = ctx.workspaceId;
  const p = await getProduction(ctx.db, ws, id);
  const steps = await getSteps(ctx.db, ws, id);
  const row = steps.find((s) => s.step === step);
  if (row?.status !== "waiting") {
    throw new FactoryError("not_waiting", "That step isn't waiting for approval.");
  }
  if (step === "face_quote" && !opts.auto) {
    // Approving pays: check the quote against the caps first.
    const quote = (row.output as unknown as Partial<QuoteOutput>).quote?.totalUsd ?? 0;
    const settings = await loadFactorySettings(ctx.db, ws);
    const avatar = p.avatar_id ? await getAvatar(ctx.db, ws, p.avatar_id) : null;
    const spend = await spendSoFar(ctx.db, ws, id, ctx.now);
    const check = checkBudget(quote, spend, capsFor(settings.caps, avatarCap(avatar)));
    if (!check.ok) {
      throw new FactoryError(
        "budget",
        `The quote ($${quote.toFixed(2)}) is over what is left under the ${check.which === "video" ? "per-video" : "monthly"} cap ($${check.remainingUsd.toFixed(2)}). Raise the cap in Settings or pick a cheaper model.`,
      );
    }
  }
  await updateStep(ctx.db, ws, id, step, {
    status: "approved",
    message: opts.auto ? "Approved on autopilot." : null,
  });
  const next = nextStep(step, p.use_avatar);
  if (next) {
    const nextRow = steps.find((s) => s.step === next);
    if (nextRow && nextRow.status !== "approved") return fireStep(ctx, id, next, null);
  }
  await refreshStatus(ctx, id);
  return null;
}

/** Reruns a step (rejected or reworked) and resets the steps after it. */
export async function redoFrom(
  ctx: EngineContext,
  id: string,
  step: FactoryStep,
  note: string | null,
): Promise<StartOutcome> {
  const ws = ctx.workspaceId;
  const p = await getProduction(ctx.db, ws, id);
  if (p.status === "scheduled") {
    throw new FactoryError(
      "scheduled",
      "This video is already queued. Remove the post first, or remake it.",
    );
  }
  const order = stepsFor(p.use_avatar);
  const later = order.slice(order.indexOf(step) + 1);
  if (later.length) {
    const { error } = await ctx.db
      .from("production_steps")
      .update({ status: "pending", progress: 0, message: null })
      .eq("workspace_id", ws)
      .eq("production_id", id)
      .in("step", later);
    if (error) fail("resetting the later steps", error);
  }
  return fireStep(ctx, id, step, note);
}

export interface ReworkRequest {
  target: ReworkTarget;
  ref: string | null;
  note: string;
  quoteUsd: number;
}

/**
 * Records what to redo and reruns the step it needs. A caption rework only changes the page.
 * Only an avatar-slot rework pays again, and only for that slot.
 */
export async function requestRework(
  ctx: EngineContext,
  id: string,
  req: ReworkRequest,
): Promise<StartOutcome | null> {
  const ws = ctx.workspaceId;
  const p = await getProduction(ctx.db, ws, id);
  if (req.target === "avatar_slot" && !p.use_avatar) {
    throw new FactoryError("no_avatar", "This video has no avatar slots.");
  }
  const { error } = await ctx.db.from("production_reworks").insert({
    workspace_id: ws,
    production_id: id,
    target: req.target,
    ref: req.ref,
    note: req.note,
    quote_usd: req.target === "avatar_slot" ? req.quoteUsd : 0,
    status: req.target === "caption" ? "done" : "running",
  });
  if (error) fail("saving the rework", error);
  const step = reworkStep(req.target);
  if (!step) return null;
  const note = [labelFor(req), req.note].filter(Boolean).join(": ");
  const outcome = await redoFrom(ctx, id, step, note);
  // Non-avatar reworks are done once their step has rerun; avatar-slot ones when the clip is made.
  if (req.target !== "avatar_slot") {
    await ctx.db
      .from("production_reworks")
      .update({ status: "done" })
      .eq("workspace_id", ws)
      .eq("production_id", id)
      .neq("target", "avatar_slot")
      .eq("status", "running");
  }
  return outcome;
}

function labelFor(req: ReworkRequest): string {
  const what = {
    script_line: "script line",
    scene: "scene",
    voice: "voice",
    music: "music",
    caption: "caption",
    avatar_slot: "avatar slot",
  }[req.target];
  return req.ref ? `${what} ${req.ref}` : what;
}

export async function failStep(
  ctx: EngineContext,
  id: string,
  step: FactoryStep,
  message: string,
): Promise<void> {
  await updateStep(ctx.db, ctx.workspaceId, id, step, {
    status: "failed",
    message: message.slice(0, 1000),
    finished_at: ctx.now.toISOString(),
  });
  await refreshStatus(ctx, id);
}

export async function refreshStatus(ctx: EngineContext, id: string): Promise<ProductionStatus> {
  const p = await getProduction(ctx.db, ctx.workspaceId, id);
  const steps: StepRow[] = await getSteps(ctx.db, ctx.workspaceId, id);
  const status = productionStatus(
    steps.map((s) => ({ step: s.step, status: s.status })),
    p.status === "draft" && steps.length > 0 ? "running" : p.status,
  );
  if (status !== p.status) await updateProduction(ctx.db, ctx.workspaceId, id, { status });
  return status;
}
