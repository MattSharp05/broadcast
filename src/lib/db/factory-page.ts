import "server-only";
import { nowFor } from "@/lib/clock";
import { capsFor, checkBudget, spendOf } from "@/lib/domain/factory/budget";
import { FACE_MODELS, isFree, isSelectable } from "@/lib/domain/factory/models";
import { recipeRows, type RecipeRow } from "@/lib/domain/factory/recipe";
import {
  STEP_LABELS,
  modeFor,
  parseModes,
  stepsFor,
  type FactoryStep,
  type StepMode,
  type StepModes,
  type StepStatus,
} from "@/lib/domain/factory/steps";
import { ago, whenLabel } from "@/lib/domain/format";
import { planQueue } from "@/lib/domain/queue";
import { signOutputUrls, signedUrlFor } from "@/lib/factory/assets";
import { MESH_MODELS, isMeshSelectable, meshOptions, meshPrice } from "@/lib/domain/factory/mesh";
import { routineConfigured } from "@/lib/factory/runner";
import { createAdminSupabase } from "./admin";
import {
  avatarCap,
  avatarGeneration,
  fail,
  getProduction,
  loadFactorySettings,
  spendSoFar,
  type FactorySettings,
} from "./factory";
import { createServerSupabase } from "./server";
import type { Json } from "./types";
import { currentWorkspace, type Workspace } from "./workspace";

/** What the Content Factory pages show. Reads as the signed-in user (RLS); keys never leave. */

export interface VideoListItem {
  id: string;
  title: string;
  handle: string | null;
  style: string | null;
  avatar: string | null;
  status: string;
  stepLabel: string | null;
  spendUsd: number;
  updated: string;
}

export interface FactoryList {
  videos: VideoListItem[];
  monthUsd: number;
  caps: FactorySettings["caps"];
  sandbox: boolean;
}

export async function loadFactoryList(): Promise<FactoryList> {
  const db = await createServerSupabase();
  const workspace = await currentWorkspace();
  const ws = workspace.id;
  const now = nowFor(workspace);
  const [prods, steps, jobs, accounts, avatars, settings, spend] = await Promise.all([
    db
      .from("productions")
      .select("*")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false }),
    db.from("production_steps").select("production_id, step, status").eq("workspace_id", ws),
    db.from("gen_jobs").select("production_id, status, quote_usd, cost_usd").eq("workspace_id", ws),
    db.from("social_accounts").select("id, handle").eq("workspace_id", ws),
    db.from("avatars").select("id, name").eq("workspace_id", ws),
    loadFactorySettings(db, ws),
    spendSoFar(db, ws, null, now),
  ]);
  for (const r of [prods, steps, jobs, accounts, avatars])
    if (r.error) fail("reading the factory", r.error);
  const handle = new Map((accounts.data ?? []).map((a) => [a.id, a.handle]));
  const avatarName = new Map((avatars.data ?? []).map((a) => [a.id, a.name]));
  const videos = (prods.data ?? []).map((p) => {
    const own = (steps.data ?? []).filter((s) => s.production_id === p.id);
    const order = stepsFor(p.use_avatar);
    const current =
      own.find((s) => s.status === "failed") ??
      own.find((s) => s.status === "waiting") ??
      own.find((s) => s.status === "running") ??
      [...own]
        .sort((a, b) => order.indexOf(b.step) - order.indexOf(a.step))
        .find((s) => s.status === "approved");
    return {
      id: p.id,
      title: p.title || p.idea || "Untitled video",
      handle: p.account_id ? (handle.get(p.account_id) ?? null) : null,
      style: p.style,
      avatar: p.use_avatar && p.avatar_id ? (avatarName.get(p.avatar_id) ?? null) : null,
      status: p.status,
      stepLabel: current ? STEP_LABELS[current.step] : null,
      spendUsd: spendOf((jobs.data ?? []).filter((j) => j.production_id === p.id)),
      updated: ago(new Date(p.updated_at), now),
    };
  });
  return {
    videos,
    monthUsd: spend.monthUsd,
    caps: settings.caps,
    sandbox: workspace.kind === "sandbox",
  };
}

export interface StepView {
  step: FactoryStep;
  label: string;
  status: StepStatus;
  progress: number;
  message: string | null;
  output: Json;
  attempt: number;
  sessionUrl: string | null;
  mode: StepMode;
}

export interface VoiceOption {
  key: string;
  label: string;
  description: string;
  sampleUrl: string | null;
  sampleText: string | null;
  licence: string;
  credit: string;
  paid: boolean;
}

export interface MusicOption {
  key: string;
  title: string;
  artist: string;
  licence: string;
  credit: string;
  sourceUrl: string;
  sampleUrl: string;
  mood: string;
}

export interface AccountOption {
  id: string;
  handle: string;
  /** "Tomorrow, 13:00", or null without slots. */
  nextSlot: string | null;
  aiLabelDone: boolean;
  aiBioDone: boolean;
  hasAvatar: boolean;
  faceModel: string | null;
}

export interface AvatarOption {
  id: string;
  name: string;
  version: number;
  accountId: string | null;
  faceModel: string | null;
  capUsd: number | null;
}

export interface ModelOption {
  key: string;
  label: string;
  pricePerS: number;
  maxS: number;
  status: string;
  notes: string;
  enabled: boolean;
  selectable: boolean;
  free: boolean;
}

export interface ProductionPage {
  id: string;
  title: string;
  idea: string;
  style: string | null;
  useAvatar: boolean;
  avatarId: string | null;
  avatarVersion: number | null;
  faceModel: string | null;
  voiceKey: string | null;
  musicKey: string | null;
  accountId: string | null;
  status: string;
  stepModes: StepModes;
  script: Json;
  caption: string | null;
  captionOptions: string[];
  mediaId: string | null;
  postId: string | null;
  post: { handle: string; when: string | null; status: string } | null;
  sessionUrl: string | null;
  projectSlug: string | null;
  remakeOf: string | null;
  steps: StepView[];
  recipe: RecipeRow[];
  spend: {
    videoUsd: number;
    monthUsd: number;
    capVideoUsd: number;
    capMonthUsd: number;
    remainingUsd: number;
  };
  jobs: {
    id: string;
    slot: string;
    model: string;
    status: string;
    costUsd: number | null;
    quoteUsd: number;
    createdAt: string;
  }[];
  reworks: {
    id: string;
    target: string;
    ref: string | null;
    note: string;
    quoteUsd: number;
    status: string;
    createdAt: string;
  }[];
  heroes: HeroView[];
}

export interface HeroView {
  id: string;
  proposalId: string;
  object: string;
  scene: string;
  reason: string;
  whyGenerate: string;
  onScreen: string;
  input: { mode: string; prompt: string | null; image: string | null };
  suggestedModel: string | null;
  estimateUsd: number;
  stills: { label: string; url: string }[];
  comparisonStills: { label: string; url: string }[];
  stage: "proposal" | "comparison";
  status: "pending" | "decided";
  decisions: {
    stage: string;
    choice: string;
    model: string | null;
    budgetUsd: number | null;
    notes: string;
    reason: string;
    decidedAt: string;
  }[];
  jobs: { model: string; status: string; costUsd: number | null; quoteUsd: number }[];
}

export interface MeshOptionView {
  key: string;
  label: string;
  priceUsd: number;
  status: string;
  licence: string;
  credit: string | null;
  text: boolean;
  pickable: boolean;
}

export interface FactoryOptions {
  voices: VoiceOption[];
  music: MusicOption[];
  accounts: AccountOption[];
  avatars: AvatarOption[];
  models: ModelOption[];
  defaultFaceModel: string;
  meshModels: MeshOptionView[];
  defaultMeshModel: string;
  workspaceModes: StepModes;
  sandbox: boolean;
  routineReady: boolean;
  timezone: string;
}

export async function loadFactoryOptions(workspace?: Workspace): Promise<FactoryOptions> {
  const db = await createServerSupabase();
  const w = workspace ?? (await currentWorkspace());
  const ws = w.id;
  const now = nowFor(w);
  const timezone = w.timezone ?? "UTC";
  const mesh = await db
    .from("factory_settings")
    .select("enabled_mesh_models, default_mesh_model")
    .eq("workspace_id", ws)
    .maybeSingle();
  const [voices, music, accounts, avatars, settings, keys] = await Promise.all([
    db.from("factory_voices").select("*").order("sort"),
    db.from("factory_music").select("*").order("sort"),
    db
      .from("social_accounts")
      .select("id, handle, slots, created_at, ai_label_done, ai_bio_done, face_model")
      .eq("workspace_id", ws)
      .order("created_at"),
    db
      .from("avatars")
      .select("id, name, current_version, account_id, profile")
      .eq("workspace_id", ws)
      .order("created_at"),
    loadFactorySettings(db, ws),
    // Which providers have a key (the service role reads gen_keys; nothing but the name leaves).
    createAdminSupabase().from("gen_keys").select("provider").eq("workspace_id", ws),
  ]);
  for (const r of [voices, music, accounts, avatars, keys])
    if (r.error) fail("reading the options", r.error);
  const withKey = new Set((keys.data ?? []).map((k) => k.provider));
  const avatarAccounts = new Set((avatars.data ?? []).map((a) => a.account_id).filter(Boolean));
  return {
    voices: (voices.data ?? []).map((v) => ({
      key: v.key,
      label: v.label,
      description: v.description,
      sampleUrl: v.sample_url,
      sampleText: v.sample_text,
      licence: v.licence,
      credit: v.credit,
      paid: v.paid,
    })),
    music: (music.data ?? []).map((m) => ({
      key: m.key,
      title: m.title,
      artist: m.artist,
      licence: m.licence,
      credit: m.credit,
      sourceUrl: m.source_url,
      sampleUrl: m.sample_url,
      mood: m.mood,
    })),
    accounts: (accounts.data ?? []).map((a) => {
      const slot = firstSlot(a.slots, timezone, now);
      return {
        id: a.id,
        handle: a.handle,
        nextSlot: slot ? whenLabel(slot, now, timezone) : null,
        aiLabelDone: a.ai_label_done,
        aiBioDone: a.ai_bio_done,
        hasAvatar: avatarAccounts.has(a.id),
        faceModel: a.face_model,
      };
    }),
    avatars: (avatars.data ?? []).map((a) => {
      const gen = avatarGeneration({ ...a, profile: a.profile } as never);
      return {
        id: a.id,
        name: a.name,
        version: a.current_version,
        accountId: a.account_id,
        faceModel: gen.faceModel,
        capUsd: avatarCap({ profile: a.profile } as never),
      };
    }),
    models: FACE_MODELS.map((m) => ({
      key: m.key,
      label: m.label,
      pricePerS: m.pricePerS,
      maxS: m.maxS,
      status: m.status,
      notes: m.notes,
      enabled: isFree(m) || settings.enabledModels.includes(m.key),
      selectable: isSelectable(m) && (isFree(m) || withKey.has(m.provider) || w.kind === "sandbox"),
      free: isFree(m),
    })),
    defaultFaceModel: settings.defaultFaceModel,
    meshModels: MESH_MODELS.map((m) => ({
      key: m.key,
      label: m.label,
      priceUsd: meshPrice(m, meshOptions(m, null)),
      status: m.status,
      licence: m.licence.summary,
      credit: m.licence.credit ?? null,
      text: m.text,
      pickable:
        isMeshSelectable(m) &&
        (m.priceUsd === 0 ||
          w.kind === "sandbox" ||
          (mesh.data?.enabled_mesh_models ?? []).includes(m.key)),
    })),
    defaultMeshModel: mesh.data?.default_mesh_model ?? "placeholder",
    workspaceModes: settings.stepModes,
    sandbox: w.kind === "sandbox",
    routineReady: w.kind === "sandbox" || routineConfigured(),
    timezone,
  };
}

/** The account's next slot after now (ignores its backlog: a hint, not the queue's answer). */
function firstSlot(slots: readonly string[], timezone: string, now: Date): Date | null {
  const planned = planQueue({
    slots,
    timezone,
    now,
    posts: [{ id: "probe", timing: "queue", queuePosition: 0, status: "queued" }],
  });
  return planned[0]?.scheduledAt ?? null;
}

export async function loadProductionPage(id: string): Promise<ProductionPage | null> {
  const db = await createServerSupabase();
  const workspace = await currentWorkspace();
  const ws = workspace.id;
  const now = nowFor(workspace);
  let p;
  try {
    p = await getProduction(db, ws, id);
  } catch {
    return null;
  }
  const [steps, jobs, reworks, settings, spend, media, post, avatar] = await Promise.all([
    db.from("production_steps").select("*").eq("workspace_id", ws).eq("production_id", id),
    db
      .from("gen_jobs")
      .select("*")
      .eq("workspace_id", ws)
      .eq("production_id", id)
      .order("created_at"),
    db
      .from("production_reworks")
      .select("*")
      .eq("workspace_id", ws)
      .eq("production_id", id)
      .order("created_at"),
    loadFactorySettings(db, ws),
    spendSoFar(db, ws, id, now),
    p.media_id
      ? db
          .from("media_assets")
          .select("recipe")
          .eq("workspace_id", ws)
          .eq("id", p.media_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    p.post_id
      ? db
          .from("posts")
          .select("scheduled_at, status, account_id, social_accounts(handle)")
          .eq("workspace_id", ws)
          .eq("id", p.post_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    p.avatar_id
      ? db
          .from("avatars")
          .select("profile")
          .eq("workspace_id", ws)
          .eq("id", p.avatar_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [steps, jobs, reworks]) if (r.error) fail("reading the video", r.error);
  const videoModes = parseModes(p.step_modes);
  const order = stepsFor(p.use_avatar);
  const caps = capsFor(settings.caps, avatarCap(avatar.data as never));
  const timezone = workspace.timezone ?? "UTC";
  const postRow = post.data as {
    scheduled_at: string | null;
    status: string;
    social_accounts: { handle: string } | null;
  } | null;
  return {
    id: p.id,
    title: p.title,
    idea: p.idea,
    style: p.style,
    useAvatar: p.use_avatar,
    avatarId: p.avatar_id,
    avatarVersion: p.avatar_version,
    faceModel: p.face_model,
    voiceKey: p.voice_key,
    musicKey: p.music_key,
    accountId: p.account_id,
    status: p.status,
    stepModes: videoModes,
    script: p.script,
    caption: p.caption,
    captionOptions: Array.isArray(p.caption_options)
      ? p.caption_options.filter((c): c is string => typeof c === "string")
      : [],
    mediaId: p.media_id,
    postId: p.post_id,
    post: postRow
      ? {
          handle: postRow.social_accounts?.handle ?? "",
          when: postRow.scheduled_at
            ? whenLabel(new Date(postRow.scheduled_at), now, timezone)
            : null,
          status: postRow.status,
        }
      : null,
    sessionUrl: p.session_url,
    projectSlug: p.project_slug,
    remakeOf: p.remake_of,
    steps: await Promise.all(
      order.map(async (step) => {
        const row = (steps.data ?? []).find((s) => s.step === step);
        return {
          step,
          label: STEP_LABELS[step],
          status: row?.status ?? "pending",
          progress: row?.progress ?? 0,
          message: row?.message ?? null,
          // Session uploads are `storage:` paths: signed for an hour.
          output: await signOutputUrls(createAdminSupabase(), row?.output ?? {}, ws),
          attempt: row?.attempt ?? 0,
          sessionUrl: row?.session_url ?? null,
          mode: modeFor(step, videoModes, settings.stepModes),
        };
      }),
    ),
    recipe: recipeRows(media.data?.recipe ?? null),
    spend: {
      videoUsd: spend.videoUsd,
      monthUsd: spend.monthUsd,
      capVideoUsd: caps.perVideoUsd,
      capMonthUsd: caps.monthlyUsd,
      remainingUsd: checkBudget(0, spend, caps).remainingUsd,
    },
    jobs: (jobs.data ?? []).map((j) => ({
      id: j.id,
      slot: j.slot,
      model: j.model,
      status: j.status,
      costUsd: j.cost_usd,
      quoteUsd: j.quote_usd,
      createdAt: j.created_at,
    })),
    reworks: (reworks.data ?? []).map((r) => ({
      id: r.id,
      target: r.target,
      ref: r.ref,
      note: r.note,
      quoteUsd: r.quote_usd,
      status: r.status,
      createdAt: r.created_at,
    })),
    heroes: await loadHeroes(db, ws, id),
  };
}

async function loadHeroes(
  db: Awaited<ReturnType<typeof createServerSupabase>>,
  ws: string,
  productionId: string,
): Promise<HeroView[]> {
  const [proposals, decisions, jobs] = await Promise.all([
    db
      .from("hero_proposals")
      .select("*")
      .eq("workspace_id", ws)
      .eq("production_id", productionId)
      .order("created_at"),
    db.from("hero_decisions").select("*").eq("workspace_id", ws).order("decided_at"),
    db
      .from("gen_jobs")
      .select("slot, model, status, cost_usd, quote_usd")
      .eq("workspace_id", ws)
      .eq("production_id", productionId)
      .eq("kind", "mesh"),
  ]);
  for (const r of [proposals, decisions, jobs])
    if (r.error) fail("reading the hero proposals", r.error);
  const admin = createAdminSupabase();
  const sign = (items: unknown) =>
    Promise.all(
      (Array.isArray(items) ? (items as { label: string; url: string }[]) : []).map(async (s) => ({
        label: s.label,
        url: await signedUrlFor(admin, s.url, ws),
      })),
    );
  return Promise.all(
    (proposals.data ?? []).map(async (p) => {
      const input = p.input as {
        mode?: string;
        prompt?: string | null;
        image?: string | null;
      };
      return {
        id: p.id,
        proposalId: p.proposal_id,
        object: p.object,
        scene: p.scene,
        reason: p.reason,
        whyGenerate: p.why_generate,
        onScreen: p.on_screen,
        input: {
          mode: input.mode ?? "image",
          prompt: input.prompt ?? null,
          image: input.image ? await signedUrlFor(admin, input.image, ws) : null,
        },
        suggestedModel: p.suggested_model,
        estimateUsd: p.estimate_usd,
        stills: await sign(p.stills),
        comparisonStills: await sign(p.comparison_stills),
        stage: p.stage === "comparison" ? "comparison" : "proposal",
        status: p.status === "decided" ? "decided" : "pending",
        decisions: (decisions.data ?? [])
          .filter((d) => d.hero_proposal_id === p.id)
          .map((d) => ({
            stage: d.stage,
            choice: d.choice,
            model: d.model,
            budgetUsd: d.budget_usd,
            notes: d.notes,
            reason: d.reason,
            decidedAt: d.decided_at,
          })),
        jobs: (jobs.data ?? [])
          .filter((j) => j.slot === p.proposal_id)
          .map((j) => ({
            model: j.model,
            status: j.status,
            costUsd: j.cost_usd,
            quoteUsd: j.quote_usd,
          })),
      };
    }),
  );
}
