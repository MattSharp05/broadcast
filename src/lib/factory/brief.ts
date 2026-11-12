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
import type { EngineContext } from "./engine";
import { faceModelFor } from "./engine";

/** GET /api/factory/{id}/brief (docs/factory-api.md): everything a step needs. */
export async function buildBrief(ctx: EngineContext, id: string) {
  const ws = ctx.workspaceId;
  const p = await getProduction(ctx.db, ws, id);
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
  };
}
