import "server-only";
import { randomUUID } from "node:crypto";
import { decryptToken, tokenKeyFromEnv } from "@/lib/crypto/tokens";
import {
  FactoryError,
  fail,
  getProduction,
  loadFactorySettings,
  spendSoFar,
  type Db,
} from "@/lib/db/factory";
import type { Database, Json } from "@/lib/db/types";
import { checkBudget } from "@/lib/domain/factory/budget";
import {
  falMeshRequest,
  isChoice,
  isMeshSelectable,
  meshApproval,
  meshModel,
  meshOptions,
  meshPrice,
  type HeroChoice,
  type HeroStage,
} from "@/lib/domain/factory/mesh";
import { FACTORY_BUCKET, parseRef, signedUrlFor } from "./assets";
import { GenError } from "./gen";
import { falQueue } from "./gen-providers";

/**
 * Hero 3D assets (BC-30): proposals from sessions, Matthew's decisions, and mesh jobs through
 * fal behind the same caps, idempotency and spend log as the face clips. A mesh job runs only
 * after a `generate` decision for that proposal and model; autopilot never decides.
 */

export type HeroProposalRow = Database["public"]["Tables"]["hero_proposals"]["Row"];
export type HeroDecisionRow = Database["public"]["Tables"]["hero_decisions"]["Row"];
type GenJobRow = Database["public"]["Tables"]["gen_jobs"]["Row"];

export interface HeroContext {
  db: Db;
  workspaceId: string;
  sandbox: boolean;
  now: Date;
}

const MAX_STILLS = 12;
const DATA_URI = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/;

/** A still or input image: a data URI is stored in the factory bucket; refs and https URLs stay. */
async function storeImage(
  ctx: HeroContext,
  productionId: string,
  value: unknown,
): Promise<string | null> {
  if (typeof value !== "string" || !value) return null;
  if (value.startsWith("storage:")) {
    if (!parseRef(value, ctx.workspaceId, productionId))
      throw new GenError(422, "bad_image", "That storage: path isn't this video's.");
    return value;
  }
  if (value.startsWith("https://")) return value;
  const m = DATA_URI.exec(value);
  if (!m)
    throw new GenError(
      422,
      "bad_image",
      "Images are a PNG/JPEG data URI, an https URL or a storage: path.",
    );
  const type = m[1] ?? "image/png";
  const path = `${ctx.workspaceId}/${productionId}/hero-${randomUUID()}.${type === "image/png" ? "png" : "jpg"}`;
  const bytes = Buffer.from(m[2] ?? "", "base64");
  const { error } = await ctx.db.storage
    .from(FACTORY_BUCKET)
    .upload(path, bytes, { contentType: type });
  if (error) throw new Error(`Storing the image failed: ${error.message}`);
  return `storage:${FACTORY_BUCKET}/${path}`;
}

function str(v: unknown, max = 2000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function upsertProposal(
  ctx: HeroContext,
  productionId: string,
  body: Record<string, unknown>,
): Promise<{ proposal_id: string; status: "pending" }> {
  const proposalId = str(body.proposal_id, 120);
  if (!proposalId) throw new GenError(422, "bad_proposal", "proposal_id is required.");
  const stage: HeroStage = body.stage === "comparison" ? "comparison" : "proposal";
  await getProduction(ctx.db, ctx.workspaceId, productionId);
  const rawStills = Array.isArray(body.stills) ? body.stills.slice(0, MAX_STILLS) : [];
  const stills: { label: string; url: string }[] = [];
  for (const s of rawStills) {
    if (!s || typeof s !== "object") continue;
    const item = s as Record<string, unknown>;
    const url = await storeImage(ctx, productionId, item.image ?? item.url);
    if (url) stills.push({ label: str(item.label, 80) || "still", url });
  }
  const existing = await ctx.db
    .from("hero_proposals")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .eq("proposal_id", proposalId)
    .maybeSingle();
  if (existing.error) fail("reading the proposal", existing.error);
  if (existing.data && existing.data.production_id !== productionId) {
    throw new GenError(409, "proposal_taken", "That proposal_id belongs to another video.");
  }

  if (stage === "comparison") {
    if (!existing.data)
      throw new GenError(404, "no_proposal", "Post the proposal before its comparison.");
    // Idempotent: the same comparison posted twice keeps the first stills.
    if (existing.data.stage === "comparison") return { proposal_id: proposalId, status: "pending" };
    const { error } = await ctx.db
      .from("hero_proposals")
      .update({
        stage: "comparison",
        status: "pending",
        comparison_stills: stills,
      })
      .eq("id", existing.data.id);
    if (error) fail("saving the comparison", error);
    return { proposal_id: proposalId, status: "pending" };
  }
  if (existing.data) return { proposal_id: proposalId, status: "pending" };

  const input = (body.input && typeof body.input === "object" ? body.input : {}) as Record<
    string,
    unknown
  >;
  const inputImage = await storeImage(ctx, productionId, input.image);
  const { error } = await ctx.db.from("hero_proposals").insert({
    workspace_id: ctx.workspaceId,
    production_id: productionId,
    proposal_id: proposalId,
    object: str(body.object, 120) || "Hero object",
    scene: str(body.scene, 120),
    reason: str(body.reason),
    why_generate: str(body.why_generate),
    on_screen: str(body.on_screen, 200),
    input: {
      mode: input.mode === "text" ? "text" : "image",
      prompt: str(input.prompt) || null,
      image: inputImage,
    } as NonNullable<Json>,
    suggested_model: str(body.suggested_model, 60) || null,
    estimate_usd:
      typeof body.estimate_usd === "number" && body.estimate_usd >= 0 ? body.estimate_usd : 0,
    options: (Array.isArray(body.options) ? body.options.slice(0, 20) : []) as NonNullable<Json>,
    stills: stills as unknown as NonNullable<Json>,
  });
  if (error) fail("saving the proposal", error);
  return { proposal_id: proposalId, status: "pending" };
}

async function proposalRow(
  ctx: HeroContext,
  proposalId: string,
  productionId?: string,
): Promise<HeroProposalRow> {
  let q = ctx.db
    .from("hero_proposals")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .eq("proposal_id", proposalId);
  if (productionId) q = q.eq("production_id", productionId);
  const { data, error } = await q.maybeSingle();
  if (error) fail("reading the proposal", error);
  if (!data) throw new GenError(404, "no_proposal", "No such proposal for this video.");
  return data;
}

async function decisionsFor(ctx: HeroContext, heroId: string): Promise<HeroDecisionRow[]> {
  const { data, error } = await ctx.db
    .from("hero_decisions")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .eq("hero_proposal_id", heroId)
    .order("decided_at");
  if (error) fail("reading the decisions", error);
  return data;
}

/** GET /api/factory/hero-proposals/{id}: pending, or the decision for the current stage. */
export async function proposalStatus(ctx: HeroContext, proposalId: string, productionId: string) {
  const p = await proposalRow(ctx, proposalId, productionId);
  const d = (await decisionsFor(ctx, p.id)).filter((x) => x.stage === p.stage).at(-1);
  return {
    proposal_id: p.proposal_id,
    stage: p.stage,
    status: p.status,
    decision:
      p.status === "decided" && d
        ? {
            choice: d.choice,
            model: d.model,
            budget_usd: d.budget_usd,
            notes: d.notes,
            reason: d.reason,
            decided_at: d.decided_at,
          }
        : null,
  };
}

/** The export the video-editor skill learns from (every decision, oldest first). */
export async function decisionsExport(ctx: HeroContext) {
  const [decisions, proposals, jobs] = await Promise.all([
    ctx.db
      .from("hero_decisions")
      .select("*")
      .eq("workspace_id", ctx.workspaceId)
      .order("decided_at"),
    ctx.db
      .from("hero_proposals")
      .select("id, proposal_id, production_id, object")
      .eq("workspace_id", ctx.workspaceId),
    ctx.db
      .from("gen_jobs")
      .select("slot, cost_usd, status")
      .eq("workspace_id", ctx.workspaceId)
      .eq("kind", "mesh"),
  ]);
  for (const r of [decisions, proposals, jobs]) if (r.error) fail("reading the decisions", r.error);
  const byId = new Map((proposals.data ?? []).map((p) => [p.id, p]));
  return (decisions.data ?? []).map((d) => {
    const p = byId.get(d.hero_proposal_id);
    const cost = (jobs.data ?? [])
      .filter((j) => j.slot === p?.proposal_id && j.status !== "failed")
      .reduce((s, j) => s + (j.cost_usd ?? 0), 0);
    return {
      proposal_id: p?.proposal_id ?? null,
      video_id: p?.production_id ?? null,
      object: p?.object ?? null,
      stage: d.stage,
      choice: d.choice,
      model: d.model,
      cost_usd: Math.round(cost * 10_000) / 10_000,
      reason: d.reason,
      decided_at: d.decided_at,
    };
  });
}

/** Matthew's decision on the page. A `generate` needs an enabled model and fits the caps. */
export async function decide(
  ctx: HeroContext,
  heroId: string,
  input: { choice: unknown; model?: unknown; notes?: unknown; reason?: unknown },
): Promise<HeroChoice> {
  const { data: p, error } = await ctx.db
    .from("hero_proposals")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", heroId)
    .maybeSingle();
  if (error) fail("reading the proposal", error);
  if (!p) throw new FactoryError("not_found", "No such proposal.");
  const stage = p.stage as HeroStage;
  if (!isChoice(stage, input.choice)) throw new FactoryError("bad_choice", "Choose what to do.");
  const reason = str(input.reason, 1000);
  if (!reason)
    throw new FactoryError(
      "no_reason",
      "Say why in a few words: the video-editor skill learns from it.",
    );
  let model: string | null = null;
  let budget: number | null = null;
  if (input.choice === "generate") {
    const m = meshModel(typeof input.model === "string" ? input.model : null);
    if (!m || !isMeshSelectable(m)) throw new FactoryError("bad_model", "Pick a 3D model.");
    const settings = await ctx.db
      .from("factory_settings")
      .select("enabled_mesh_models")
      .eq("workspace_id", ctx.workspaceId)
      .single();
    if (settings.error) fail("reading the settings", settings.error);
    if (m.priceUsd > 0 && !settings.data.enabled_mesh_models.includes(m.key) && !ctx.sandbox) {
      throw new FactoryError(
        "model_disabled",
        `${m.label} isn't enabled. Turn it on in Content Factory → Settings → 3D models.`,
      );
    }
    model = m.key;
    budget = meshPrice(m, meshOptions(m, null));
    const caps = (await loadFactorySettings(ctx.db, ctx.workspaceId)).caps;
    const check = checkBudget(
      budget,
      await spendSoFar(ctx.db, ctx.workspaceId, p.production_id, ctx.now),
      caps,
    );
    if (!check.ok) {
      throw new FactoryError(
        "budget",
        `This model (~$${budget.toFixed(2)}) would pass the ${check.which === "video" ? "per-video" : "monthly"} cap: $${check.remainingUsd.toFixed(2)} is left.`,
      );
    }
  }
  const ins = await ctx.db.from("hero_decisions").insert({
    workspace_id: ctx.workspaceId,
    hero_proposal_id: p.id,
    stage,
    choice: input.choice,
    model,
    budget_usd: budget,
    notes: str(input.notes, 2000),
    reason,
    decided_at: ctx.now.toISOString(),
  });
  if (ins.error) fail("saving the decision", ins.error);
  const upd = await ctx.db.from("hero_proposals").update({ status: "decided" }).eq("id", p.id);
  if (upd.error) fail("saving the proposal", upd.error);
  return input.choice;
}

export interface MeshJobRequest {
  productionId: string;
  proposalId: string;
  model: string;
  idempotencyKey: string;
  mode: "image" | "text";
  image: string | null;
  prompt: string | null;
  seed: number | null;
  options: Record<string, unknown> | string[] | null;
}

async function falKey(ctx: HeroContext): Promise<string | null> {
  const { data, error } = await ctx.db
    .from("gen_keys")
    .select("key_enc")
    .eq("workspace_id", ctx.workspaceId)
    .eq("provider", "fal")
    .maybeSingle();
  if (error) fail("reading the key", error);
  return data
    ? decryptToken(data.key_enc, tokenKeyFromEnv(), `gen_keys:${ctx.workspaceId}:fal`)
    : null;
}

export async function submitMeshJob(
  ctx: HeroContext,
  req: MeshJobRequest,
): Promise<{ job: GenJobRow; reused: boolean }> {
  const p = await proposalRow(ctx, req.proposalId, req.productionId);
  const existing = await ctx.db
    .from("gen_jobs")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .eq("idempotency_key", req.idempotencyKey)
    .maybeSingle();
  if (existing.error) fail("reading the jobs", existing.error);
  if (existing.data) return { job: existing.data, reused: true };

  const m = meshModel(req.model);
  if (!m || !isMeshSelectable(m))
    throw new GenError(422, "unknown_model", `No 3D model "${req.model}" in the registry.`);
  const options = meshOptions(m, req.options);
  const quote = meshPrice(m, options);
  const approval = meshApproval(await decisionsFor(ctx, p.id), m.key, quote);
  if (!approval.ok) {
    throw new GenError(
      403,
      "not_approved",
      approval.reason === "over_budget"
        ? `The quote ($${quote.toFixed(2)}) is over the budget Matthew approved for this proposal.`
        : "Matthew hasn't approved generating this proposal with this model. Wait for the decision (GET /api/factory/hero-proposals/{id}).",
    );
  }
  const settings = await loadFactorySettings(ctx.db, ctx.workspaceId);
  const budget = checkBudget(
    quote,
    await spendSoFar(ctx.db, ctx.workspaceId, req.productionId, ctx.now),
    settings.caps,
  );
  if (!budget.ok) {
    throw new GenError(
      402,
      "budget",
      `This model ($${quote.toFixed(2)}) would pass the ${budget.which === "video" ? "per-video" : "monthly"} cap.`,
      {
        remaining_usd: budget.remainingUsd,
      },
    );
  }
  const free = m.priceUsd === 0 && quote === 0;
  let key: string | null = null;
  let fal = null as ReturnType<typeof falMeshRequest>;
  if (!free && !ctx.sandbox) {
    key = await falKey(ctx);
    if (!key)
      throw new GenError(
        409,
        "no_key",
        "No fal key saved. Add it in Content Factory → Settings → Generation keys.",
      );
    const image = req.image ? await signedUrlFor(ctx.db, req.image, ctx.workspaceId) : null;
    fal = falMeshRequest(m, { mode: req.mode, image, prompt: req.prompt, seed: req.seed, options });
    if (!fal)
      throw new GenError(
        422,
        "bad_input",
        `${m.label} can't take that input (${req.mode === "text" ? "no text-to-3D" : "an image is required"}).`,
      );
  }
  const inserted = await ctx.db
    .from("gen_jobs")
    .insert({
      workspace_id: ctx.workspaceId,
      production_id: req.productionId,
      kind: "mesh",
      slot: p.proposal_id,
      model: m.key,
      provider: m.provider,
      idempotency_key: req.idempotencyKey,
      seconds: 1,
      quote_usd: quote,
      status: free || ctx.sandbox ? "completed" : "queued",
      cost_usd: free || ctx.sandbox ? quote : null,
      output_url: free || ctx.sandbox ? "/factory/fake/model.glb" : null,
      completed_at: free || ctx.sandbox ? ctx.now.toISOString() : null,
      input: { mode: req.mode, prompt: req.prompt, seed: req.seed, options } as NonNullable<Json>,
    })
    .select("*")
    .single();
  if (inserted.error) fail("saving the job", inserted.error);
  let job = inserted.data;
  if (fal && key) {
    try {
      const sub = await falQueue.submit(fal.endpoint, fal.input, key);
      job = await patch(ctx, job.id, {
        status: "running",
        provider_request_id: sub.requestId,
        status_url: sub.statusUrl,
        response_url: sub.responseUrl,
      });
    } catch (e) {
      job = await patch(ctx, job.id, {
        status: "failed",
        cost_usd: 0,
        error: e instanceof Error ? e.message : String(e),
        completed_at: ctx.now.toISOString(),
      });
    }
  }
  return { job, reused: false };
}

async function patch(ctx: HeroContext, id: string, values: Partial<GenJobRow>): Promise<GenJobRow> {
  const { data, error } = await ctx.db
    .from("gen_jobs")
    .update(values)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) fail("updating the job", error);
  return data;
}

const GLB_URL_TTL_S = 7 * 24 * 60 * 60;

/** A mesh job's state; when fal finishes, the .glb is copied to Broadcast's storage. */
export async function pollMeshJob(
  ctx: HeroContext,
  jobId: string,
  productionId: string,
): Promise<GenJobRow & { outputs?: unknown }> {
  const { data: job, error } = await ctx.db
    .from("gen_jobs")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .eq("production_id", productionId)
    .eq("kind", "mesh")
    .eq("id", jobId)
    .maybeSingle();
  if (error) fail("reading the job", error);
  if (!job) throw new GenError(404, "not_found", "No such job.");
  if (job.status === "completed" && job.output_url?.startsWith("storage:")) {
    return { ...job, output_url: await signedUrlFor(ctx.db, job.output_url, ctx.workspaceId) };
  }
  if (job.status !== "queued" && job.status !== "running") return job;
  const m = meshModel(job.model);
  const key = await falKey(ctx);
  if (!m?.output || !key) return job;
  const polled = await falQueue
    .poll(
      {
        requestId: job.provider_request_id ?? "",
        statusUrl: job.status_url,
        responseUrl: job.response_url,
      },
      m.output,
      key,
    )
    .catch(() => ({ status: "running" as const }));
  if (polled.status === "failed") {
    return patch(ctx, job.id, {
      status: "failed",
      error: polled.error,
      cost_usd: 0,
      completed_at: ctx.now.toISOString(),
    });
  }
  if (polled.status !== "completed")
    return polled.status !== job.status ? patch(ctx, job.id, { status: polled.status }) : job;
  if (!/\.glb(\?|$)/i.test(polled.outputUrl)) {
    // No .glb (Hunyuan Rapid can fall back to OBJ): fail it; a retry with the same key isn't charged again.
    return patch(ctx, job.id, {
      status: "failed",
      error: "The model returned no .glb.",
      cost_usd: job.quote_usd,
      completed_at: ctx.now.toISOString(),
    });
  }
  const glb = await fetch(polled.outputUrl);
  if (!glb.ok) return job;
  const path = `${ctx.workspaceId}/${productionId}/models/${job.id}.glb`;
  const up = await ctx.db.storage
    .from(FACTORY_BUCKET)
    .upload(path, new Uint8Array(await glb.arrayBuffer()), {
      contentType: "model/gltf-binary",
      upsert: true,
    });
  if (up.error) throw new Error(`Storing the .glb failed: ${up.error.message}`);
  const done = await patch(ctx, job.id, {
    status: "completed",
    output_url: `storage:${FACTORY_BUCKET}/${path}`,
    cost_usd: job.quote_usd,
    completed_at: ctx.now.toISOString(),
  });
  const signed = await ctx.db.storage.from(FACTORY_BUCKET).createSignedUrl(path, GLB_URL_TTL_S);
  return { ...done, output_url: signed.data?.signedUrl ?? done.output_url, outputs: polled.result };
}
