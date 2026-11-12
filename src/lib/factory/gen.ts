import "server-only";
import { decryptToken, encryptToken, tokenKeyFromEnv } from "@/lib/crypto/tokens";
import {
  avatarCap,
  fail,
  getAvatar,
  getProduction,
  jobsFor,
  loadFactorySettings,
  openRedoSlots,
  spendSoFar,
  type Db,
  type GenJobRow,
} from "@/lib/db/factory";
import { capsFor, checkBudget } from "@/lib/domain/factory/budget";
import { decideFaceJob } from "@/lib/domain/factory/face-jobs";
import {
  DEFAULT_FACE_PROMPT,
  faceModel,
  isFree,
  isSelectable,
  priceFor,
} from "@/lib/domain/factory/models";
import { genProviderFor, type KeyProvider } from "./gen-providers";

/**
 * The generation proxy's server side (avatar-studio hand-off): look up the model, check the caps,
 * submit with the workspace's provider key, store the job. Never charges twice for one
 * idempotency key, and never regenerates a slot's paid clip unless that slot was explicitly
 * asked to be redone (production_reworks, target avatar_slot).
 */

export interface GenContext {
  db: Db;
  workspaceId: string;
  sandbox: boolean;
  now: Date;
}

export class GenError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "GenError";
  }
}

const UNIQUE_VIOLATION = "23505";

export interface FaceJobRequest {
  productionId: string;
  slot: string;
  model: string;
  idempotencyKey: string;
  image: string;
  audio: string;
  prompt?: string | null;
  seed?: number | null;
  seconds: number;
}

export interface FaceJobResult {
  job: GenJobRow;
  /** True when an earlier job was returned instead of a new charge. */
  reused: boolean;
  reason?: "same_key" | "slot_kept";
}

function keyContext(ws: string, provider: string): string {
  return `gen_keys:${ws}:${provider}`;
}

export async function saveGenKey(
  ctx: GenContext,
  provider: KeyProvider,
  key: string,
): Promise<{ last4: string }> {
  const clean = key.trim();
  if (clean.length < 8 || clean.length > 400 || /\s/.test(clean)) {
    throw new GenError(422, "invalid_key", "That doesn't look like an API key.");
  }
  const enc = encryptToken(clean, tokenKeyFromEnv(), keyContext(ctx.workspaceId, provider));
  const last4 = clean.slice(-4);
  const { error } = await ctx.db.from("gen_keys").upsert({
    workspace_id: ctx.workspaceId,
    provider,
    key_enc: enc,
    last4,
    tested_at: null,
    test_ok: null,
    test_message: null,
  });
  if (error) fail("saving the key", error);
  return { last4 };
}

export async function deleteGenKey(ctx: GenContext, provider: KeyProvider): Promise<void> {
  const { error } = await ctx.db
    .from("gen_keys")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("provider", provider);
  if (error) fail("removing the key", error);
}

/** The decrypted key, or null. Server only: never returned to a browser or a session. */
async function providerKey(ctx: GenContext, provider: string): Promise<string | null> {
  const { data, error } = await ctx.db
    .from("gen_keys")
    .select("key_enc")
    .eq("workspace_id", ctx.workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) fail("reading the key", error);
  if (!data) return null;
  return decryptToken(data.key_enc, tokenKeyFromEnv(), keyContext(ctx.workspaceId, provider));
}

export interface MaskedKey {
  provider: string;
  last4: string;
  testedAt: string | null;
  testOk: boolean | null;
  testMessage: string | null;
}

export async function listGenKeys(ctx: GenContext): Promise<MaskedKey[]> {
  const { data, error } = await ctx.db
    .from("gen_keys")
    .select("provider, last4, tested_at, test_ok, test_message")
    .eq("workspace_id", ctx.workspaceId);
  if (error) fail("reading the keys", error);
  return data.map((k) => ({
    provider: k.provider,
    last4: k.last4,
    testedAt: k.tested_at,
    testOk: k.test_ok,
    testMessage: k.test_message,
  }));
}

export async function testGenKey(ctx: GenContext, provider: KeyProvider): Promise<MaskedKey> {
  const key = await providerKey(ctx, provider);
  if (!key) throw new GenError(404, "no_key", "No key saved for this provider.");
  const impl = genProviderFor(provider, ctx.sandbox);
  const result = impl
    ? await impl.testKey(key).catch((e: unknown) => ({
        ok: false,
        message: `Couldn't reach the provider: ${e instanceof Error ? e.message : String(e)}`,
      }))
    : { ok: false, message: "Broadcast can't call this provider yet (no adapter)." };
  const { error } = await ctx.db
    .from("gen_keys")
    .update({ tested_at: ctx.now.toISOString(), test_ok: result.ok, test_message: result.message })
    .eq("workspace_id", ctx.workspaceId)
    .eq("provider", provider);
  if (error) fail("saving the test result", error);
  return {
    provider,
    last4: key.slice(-4),
    testedAt: ctx.now.toISOString(),
    testOk: result.ok,
    testMessage: result.message,
  };
}

export async function submitFaceJob(ctx: GenContext, req: FaceJobRequest): Promise<FaceJobResult> {
  const ws = ctx.workspaceId;
  const production = await getProduction(ctx.db, ws, req.productionId);
  const model = faceModel(req.model);
  if (!model)
    throw new GenError(422, "unknown_model", `No face model "${req.model}" in the registry.`);
  if (!isSelectable(model)) {
    throw new GenError(422, "planned_model", `${model.label} is planned: there is no adapter yet.`);
  }
  const settings = await loadFactorySettings(ctx.db, ws);
  if (!isFree(model) && !settings.enabledModels.includes(model.key)) {
    throw new GenError(
      422,
      "model_disabled",
      `${model.label} isn't enabled. Turn it on in Content Factory → Settings.`,
    );
  }
  if (!(req.seconds > 0) || req.seconds > model.maxS) {
    throw new GenError(
      422,
      "bad_seconds",
      `seconds must be between 0 and ${model.maxS} for ${model.label}.`,
    );
  }

  const jobs = await jobsFor(ctx.db, ws, production.id);
  const redoSlots = await openRedoSlots(ctx.db, ws, production.id);
  const decision = decideFaceJob({
    slot: req.slot,
    idempotencyKey: req.idempotencyKey,
    jobs: jobs
      .filter((j) => j.kind === "face")
      .map((j) => ({
        id: j.id,
        slot: j.slot,
        idempotencyKey: j.idempotency_key,
        status: j.status,
        createdAt: j.created_at,
      })),
    redoSlots,
  });
  if (decision.kind === "existing") {
    const job = jobs.find((j) => j.id === decision.job.id);
    if (job) return { job, reused: true, reason: decision.reason };
  }

  const quote = priceFor(model, req.seconds);
  const avatar = production.avatar_id ? await getAvatar(ctx.db, ws, production.avatar_id) : null;
  const caps = capsFor(settings.caps, avatarCap(avatar));
  const spend = await spendSoFar(ctx.db, ws, production.id, ctx.now);
  const budget = checkBudget(quote, spend, caps);
  if (!budget.ok) {
    throw new GenError(
      402,
      "budget",
      budget.which === "video"
        ? `This clip ($${quote.toFixed(2)}) would pass the per-video cap ($${caps.perVideoUsd.toFixed(2)}).`
        : `This clip ($${quote.toFixed(2)}) would pass the monthly cap ($${caps.monthlyUsd.toFixed(2)}).`,
      { remaining_usd: budget.remainingUsd },
    );
  }

  const impl = isFree(model) ? null : genProviderFor(model.provider, ctx.sandbox);
  let key: string | null = null;
  if (!isFree(model)) {
    if (!impl) throw new GenError(422, "no_adapter", `Broadcast can't call ${model.provider} yet.`);
    key = ctx.sandbox ? "sandbox" : await providerKey(ctx, model.provider);
    if (!key) {
      throw new GenError(
        409,
        "no_key",
        `No ${model.provider} key saved. Add it in Content Factory → Settings → Generation keys.`,
      );
    }
  }

  const inserted = await ctx.db
    .from("gen_jobs")
    .insert({
      workspace_id: ws,
      production_id: production.id,
      avatar_id: production.avatar_id,
      kind: "face",
      slot: req.slot,
      model: model.key,
      provider: model.provider,
      idempotency_key: req.idempotencyKey,
      seconds: req.seconds,
      quote_usd: quote,
      status: isFree(model) ? "completed" : "queued",
      cost_usd: isFree(model) ? 0 : null,
      completed_at: isFree(model) ? ctx.now.toISOString() : null,
      input: { prompt: req.prompt ?? null, seed: req.seed ?? null },
    })
    .select("*")
    .single();
  if (inserted.error?.code === UNIQUE_VIOLATION) {
    // Another request with the same key won the race: return its job.
    const again = await jobsFor(ctx.db, ws, production.id);
    const job = again.find((j) => j.idempotency_key === req.idempotencyKey);
    if (job) return { job, reused: true, reason: "same_key" };
  }
  if (inserted.error) fail("saving the job", inserted.error);
  let job = inserted.data;

  if (decision.kind === "new" && decision.redo) {
    await ctx.db
      .from("production_reworks")
      .update({ status: "done" })
      .eq("workspace_id", ws)
      .eq("production_id", production.id)
      .eq("target", "avatar_slot")
      .eq("ref", req.slot);
  }

  if (impl && key) {
    try {
      const sub = await impl.submit(
        {
          model,
          image: req.image,
          audio: req.audio,
          prompt: req.prompt?.trim() ? req.prompt : DEFAULT_FACE_PROMPT,
          seed: req.seed ?? null,
        },
        key,
      );
      job = await patchJob(ctx, job.id, {
        status: "running",
        provider_request_id: sub.requestId,
        status_url: sub.statusUrl,
        response_url: sub.responseUrl,
      });
    } catch (e) {
      job = await patchJob(ctx, job.id, {
        status: "failed",
        cost_usd: 0,
        error: e instanceof Error ? e.message : String(e),
        completed_at: ctx.now.toISOString(),
      });
    }
  }
  return { job, reused: false };
}

async function patchJob(
  ctx: GenContext,
  id: string,
  patch: Partial<GenJobRow>,
): Promise<GenJobRow> {
  const { data, error } = await ctx.db
    .from("gen_jobs")
    .update(patch)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) fail("updating the job", error);
  return data;
}

/** A job's state, polling the provider once when it is still in flight. */
export async function pollFaceJob(
  ctx: GenContext,
  jobId: string,
  productionId?: string,
): Promise<GenJobRow> {
  let q = ctx.db.from("gen_jobs").select("*").eq("workspace_id", ctx.workspaceId).eq("id", jobId);
  if (productionId) q = q.eq("production_id", productionId);
  const { data: job, error } = await q.maybeSingle();
  if (error) fail("reading the job", error);
  if (!job) throw new GenError(404, "not_found", "No such job.");
  if (job.status !== "queued" && job.status !== "running") return job;

  const model = faceModel(job.model);
  const impl = model ? genProviderFor(model.provider, ctx.sandbox) : null;
  if (!model || !impl) return job;
  const key = ctx.sandbox ? "sandbox" : await providerKey(ctx, model.provider);
  if (!key) return job;
  const polled = await impl
    .poll(
      {
        requestId: job.provider_request_id ?? "",
        statusUrl: job.status_url,
        responseUrl: job.response_url,
      },
      model,
      key,
    )
    .catch((e: unknown) => ({ status: "running" as const, note: String(e) }));
  if (polled.status === "completed") {
    return patchJob(ctx, job.id, {
      status: "completed",
      output_url: polled.outputUrl,
      cost_usd: job.quote_usd,
      completed_at: ctx.now.toISOString(),
    });
  }
  if (polled.status === "failed") {
    return patchJob(ctx, job.id, {
      status: "failed",
      error: polled.error,
      cost_usd: 0,
      completed_at: ctx.now.toISOString(),
    });
  }
  if (polled.status !== job.status) return patchJob(ctx, job.id, { status: polled.status });
  return job;
}

/** The job as the proxy contract shows it. */
export function jobJson(job: GenJobRow) {
  return {
    job_id: job.id,
    slot: job.slot,
    model: job.model,
    status: job.status,
    quote_usd: job.quote_usd,
    cost_usd: job.cost_usd,
    output_url: job.output_url,
    error: job.error,
  };
}
