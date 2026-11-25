import "server-only";
import {
  avatarCap,
  avatarGeneration,
  getAvatar,
  getProduction,
  getSteps,
  jobsFor,
  loadFactorySettings,
  spendSoFar,
} from "@/lib/db/factory";
import { capsFor, checkBudget } from "@/lib/domain/factory/budget";
import { faceModel } from "@/lib/domain/factory/models";
import { STYLE_PACKS } from "@/lib/domain/factory/styles";
import { parseConfig } from "@/lib/domain/routines";
import { VIDEOS_BUCKET } from "@/lib/db/videos";
import { signedUrlFor } from "./assets";
import type { EngineContext } from "./engine";
import { faceModelFor } from "./engine";
import { listVersions, notesOfBatch, openBatch } from "./studio";

/** Version and crop links in the brief stay valid for 2 hours (a revise session's length). */
const BRIEF_URL_TTL_S = 2 * 60 * 60;

/** GET /api/factory/{id}/brief (docs/factory-api.md): everything a step needs. */
export async function buildBrief(ctx: EngineContext, id: string) {
  const ws = ctx.workspaceId;
  const p = await getProduction(ctx.db, ws, id);
  const [versions, batch, cards] = await Promise.all([
    listVersions(ctx.db, ws, id),
    openBatch(ctx.db, ws, id),
    ctx.db
      .from("board_cards")
      .select("position, scene_id, text, seconds, still_path, status")
      .eq("workspace_id", ws)
      .eq("production_id", id)
      .order("position"),
  ]);
  if (cards.error)
    throw new Error(`Content Factory: reading the board failed: ${cards.error.message}`);
  const [steps, jobs, reworks, settings, spend, avatar, account, voice, music] = await Promise.all([
    getSteps(ctx.db, ws, id),
    jobsFor(ctx.db, ws, id),
    ctx.db
      .from("production_reworks")
      .select("target, ref, note, status")
      .eq("workspace_id", ws)
      .eq("production_id", id)
      .order("created_at"),
    loadFactorySettings(ctx.db, ws),
    spendSoFar(ctx.db, ws, id, ctx.now),
    p.avatar_id ? getAvatar(ctx.db, ws, p.avatar_id) : Promise.resolve(null),
    p.account_id
      ? ctx.db
          .from("social_accounts")
          .select("handle")
          .eq("workspace_id", ws)
          .eq("id", p.account_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    p.voice_key
      ? ctx.db.from("factory_voices").select("*").eq("key", p.voice_key).maybeSingle()
      : Promise.resolve({ data: null }),
    p.music_key
      ? ctx.db.from("factory_music").select("*").eq("key", p.music_key).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const caps = capsFor(settings.caps, avatarCap(avatar));
  const modelKey = p.use_avatar ? await faceModelFor(ctx, p) : null;
  const model = faceModel(modelKey);
  const gen = avatarGeneration(avatar);
  const current = steps.find((s) => s.status === "running") ?? null;
  const abs = (u: string | null | undefined) =>
    u && u.startsWith("/") && ctx.appUrl ? `${ctx.appUrl}${u}` : (u ?? null);
  const keptSlots = new Set<string>();
  const sign = async (value: string | null | undefined): Promise<string | null> => {
    if (!value) return null;
    if (value.startsWith("storage:")) return signedUrlFor(ctx.db, value, ws, BRIEF_URL_TTL_S);
    if (value.startsWith(`${ws}/`)) {
      const { data } = await ctx.db.storage
        .from(VIDEOS_BUCKET)
        .createSignedUrl(value, BRIEF_URL_TTL_S);
      return data?.signedUrl ?? null;
    }
    return abs(value);
  };
  const mediaPaths = new Map<string, string>();
  const mediaIds = versions.map((v) => v.media_id).filter((m): m is string => Boolean(m));
  if (mediaIds.length) {
    const { data } = await ctx.db
      .from("media_assets")
      .select("id, storage_path")
      .eq("workspace_id", ws)
      .in("id", mediaIds);
    for (const m of data ?? []) mediaPaths.set(m.id, m.storage_path);
  }
  const versionList = await Promise.all(
    versions.map(async (v) => ({
      id: v.id,
      number: v.number,
      url: await sign(v.proxy_path ?? (v.media_id ? mediaPaths.get(v.media_id) : null)),
      duration_s: v.duration_s,
      fps: v.fps,
      git_sha: v.git_sha,
      made_by: v.made_by,
    })),
  );
  const batchNotes = batch ? await notesOfBatch(ctx.db, ws, batch.id) : [];
  const routine = await routineBrief(ctx, p.id, p.routine_id);
  return {
    video: {
      id: p.id,
      title: p.title,
      idea: p.idea,
      style: p.style,
      project_slug: p.project_slug,
      account: account.data ? `@${account.data.handle}` : null,
      use_avatar: p.use_avatar,
      avatar:
        p.use_avatar && avatar
          ? { name: avatar.name, version: p.avatar_version, profile: avatar.profile }
          : null,
      face_model: model
        ? {
            key: model.key,
            fallback: gen.fallbackModel ?? settings.fallbackFaceModel,
            price_usd_per_s: model.pricePerS,
            max_s: model.maxS,
            status: model.status,
          }
        : null,
      voice: voice.data
        ? {
            key: voice.data.key,
            label: voice.data.label,
            description: voice.data.description,
            model: voice.data.model,
            sample_url: abs(voice.data.sample_url),
            credit: voice.data.credit,
          }
        : null,
      music: music.data
        ? {
            key: music.data.key,
            title: music.data.title,
            artist: music.data.artist,
            licence: music.data.licence,
            credit: music.data.credit,
            source_url: music.data.source_url,
            sample_url: abs(music.data.sample_url),
          }
        : null,
      script: p.script,
      genre: p.genre,
      tags: p.tags,
      run_mode: p.run_mode,
      // Comparing styles (BC-41): the style step shows the same beat in 2–3 of these.
      style_compare: p.compare_styles
        ? {
            candidates: p.style_candidates,
            options: STYLE_PACKS.map((s) => ({
              key: s.key,
              label: s.label,
              suits: s.suits,
              signature: s.signature,
            })),
          }
        : null,
    },
    step: current
      ? {
          name: current.step,
          attempt: current.attempt,
          note: current.message?.replace(/^Redo: /, "") ?? null,
        }
      : null,
    outputs: Object.fromEntries(
      steps.filter((s) => s.status !== "pending").map((s) => [s.step, s.output]),
    ),
    reworks: reworks.data ?? [],
    face_clips: [...jobs]
      .reverse()
      .filter((j) => j.kind === "face" && j.status !== "failed")
      .filter((j) => (keptSlots.has(j.slot) ? false : (keptSlots.add(j.slot), true)))
      .map((j) => ({
        slot: j.slot,
        job_id: j.id,
        status: j.status,
        output_url: j.output_url,
        kept: true,
      })),
    budget: {
      spent_video_usd: spend.videoUsd,
      spent_month_usd: spend.monthUsd,
      cap_video_usd: caps.perVideoUsd,
      cap_month_usd: caps.monthlyUsd,
      remaining_usd: checkBudget(0, spend, caps).remainingUsd,
    },
    versions: versionList,
    // The storyboard Matthew approved (or is reviewing): render and revise build from it.
    board: {
      rev: p.board_rev,
      approved_at: p.board_approved_at,
      cards: await Promise.all(
        cards.data.map(async (c) => ({
          position: c.position,
          scene: c.scene_id,
          text: c.text,
          seconds: c.seconds,
          still_url: await sign(c.still_path),
          status: c.status,
        })),
      ),
    },
    // A routine's video (ADR 0009): made with no one watching; see docs/factory-api.md → Routines.
    routine,
    batch: batch
      ? {
          id: batch.id,
          version_number: versions.find((v) => v.id === batch.version_id)?.number ?? null,
          notes: await Promise.all(
            batchNotes.map(async (n) => ({
              id: n.id,
              number: n.number,
              kind: n.kind,
              t_s: n.t_s,
              frame: n.frame,
              box: n.box,
              text: n.text,
              crop_url: await sign(n.crop_path),
            })),
          ),
        }
      : null,
  };
}

/** The routine a video belongs to: its rules, references and the slot's brief. */
async function routineBrief(ctx: EngineContext, productionId: string, routineId: string | null) {
  if (!routineId) return null;
  const ws = ctx.workspaceId;
  const [routine, slot] = await Promise.all([
    ctx.db
      .from("routines")
      .select("id, name, approval, config")
      .eq("workspace_id", ws)
      .eq("id", routineId)
      .maybeSingle(),
    ctx.db
      .from("routine_slots")
      .select("id, position, post_at, brief")
      .eq("workspace_id", ws)
      .eq("production_id", productionId)
      .maybeSingle(),
  ]);
  if (!routine.data) return null;
  const config = parseConfig(routine.data.config);
  return {
    id: routine.data.id,
    name: routine.data.name,
    approval: routine.data.approval,
    autonomous: true,
    references: config.references,
    rules: config.rules,
    slot: slot.data
      ? {
          id: slot.data.id,
          position: slot.data.position,
          post_at: slot.data.post_at,
          brief: slot.data.brief,
        }
      : null,
    // What a routine's render checkpoint must carry, since no one approves the steps.
    render_must_include: ["review", "cover", "cover_t_s", "caption", "hashtags"],
    hero_assets: false,
  };
}
