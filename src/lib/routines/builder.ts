import "server-only";
import { FactoryError, getProduction, getSteps, type Db } from "@/lib/db/factory";
import type { Json } from "@/lib/db/types";
import { VIDEOS_BUCKET } from "@/lib/db/videos";
import { workspaceKindOf } from "@/lib/db/workspaces";
import { spendOf } from "@/lib/domain/factory/budget";
import { withCredits } from "@/lib/domain/factory/captions";
import { ALL_STEPS, isStep, type StepModes } from "@/lib/domain/factory/steps";
import { versionLabel } from "@/lib/domain/factory/versions";
import { whenLabel } from "@/lib/domain/format";
import {
  missedSlots,
  nextForBuild,
  parseConfig,
  parseReview,
  postTimeFor,
  routineFinished,
  slotsToStart,
  type SlotStatus,
} from "@/lib/domain/routines";
import { cleanTags } from "@/lib/domain/tags";
import { parseRef } from "@/lib/factory/assets";
import { redoFrom, startProduction, type EngineContext } from "@/lib/factory/engine";
import { scheduleVersion } from "@/lib/factory/schedule";
import {
  coverPathFor,
  listVersions,
  logEvent,
  markReady,
  saveCover,
  savePack,
  videoCredits,
} from "@/lib/factory/studio";
import { loadSettings } from "@/lib/scheduler/publish-due";
import type { Step, StepSummary, TickContext } from "@/lib/scheduler/types";
import {
  getRoutine,
  getSlots,
  updateRoutine,
  updateSlot,
  type RoutineRow,
  type Slot,
} from "./store";

/**
 * The routine builder (ADR 0009), run by every scheduler tick: for each running routine it
 * starts the videos whose slots are due (one production each, every step on autopilot, one
 * session for the whole video), finishes the ones that are ready (cover, caption, checks), then
 * schedules them at their slot (approval "auto") or leaves them for Matthew ("review").
 * It never publishes: the scheduler posts what is scheduled, as for any post.
 */

export interface BuilderCtx extends EngineContext {
  timezone: string;
}

const AUTO_MODES: StepModes = Object.fromEntries(ALL_STEPS.map((s) => [s, "auto"]));

type Counts = Record<string, number>;
const bump = (c: Counts, k: string) => (c[k] = (c[k] ?? 0) + 1);

/** The routine's paid generation so far (every video it made). */
export async function routineSpend(db: Db, ws: string, routineId: string): Promise<number> {
  const prods = await db
    .from("productions")
    .select("id")
    .eq("workspace_id", ws)
    .eq("routine_id", routineId);
  if (prods.error) throw new Error(`Reading the routine's videos failed: ${prods.error.message}`);
  if (!prods.data.length) return 0;
  const jobs = await db
    .from("gen_jobs")
    .select("status, cost_usd, quote_usd")
    .eq("workspace_id", ws)
    .in(
      "production_id",
      prods.data.map((p) => p.id),
    );
  if (jobs.error) throw new Error(`Reading the routine's spend failed: ${jobs.error.message}`);
  return spendOf(jobs.data);
}

/** Starts one slot's video: a production from its brief, every step on autopilot. */
async function startSlot(
  ctx: BuilderCtx,
  r: RoutineRow,
  slot: Slot,
  counts: Counts,
): Promise<void> {
  const ws = ctx.workspaceId;
  const b = slot.brief;
  if (!b) {
    await updateSlot(ctx.db, ws, slot.id, { status: "failed", message: "This slot has no brief." });
    bump(counts, "failed");
    return;
  }
  const config = parseConfig(r.config);
  const { data, error } = await ctx.db
    .from("productions")
    .insert({
      workspace_id: ws,
      title: b.title,
      idea: b.idea,
      genre: b.genre,
      style: b.style,
      compare_styles: false,
      voice_key: b.voiceKey,
      music_key: b.musicKey,
      use_avatar: config.useAvatar,
      avatar_id: config.useAvatar ? config.avatarId : null,
      account_id: slot.accountId,
      tags: cleanTags(r.tags),
      routine_id: r.id,
      run_mode: "one_session",
      step_modes: AUTO_MODES as unknown as NonNullable<Json>,
    })
    .select("id")
    .single();
  if (error) {
    await updateSlot(ctx.db, ws, slot.id, {
      status: "failed",
      message: `Couldn't create the video: ${error.message}`.slice(0, 1000),
    });
    bump(counts, "failed");
    return;
  }
  // Claim the slot first, so a second tick racing this one never starts it twice.
  const claim = await ctx.db
    .from("routine_slots")
    .update({
      status: "building",
      production_id: data.id,
      message: "Starting the video's session.",
    })
    .eq("workspace_id", ws)
    .eq("id", slot.id)
    .eq("status", "planned")
    .is("production_id", null)
    .select("id");
  if (claim.error || !claim.data.length) {
    await ctx.db.from("productions").delete().eq("workspace_id", ws).eq("id", data.id);
    return;
  }
  await logEvent(ctx, data.id, {
    actor: "system",
    intent: `Started by routine "${r.name}" for the post ${whenLabel(slot.postAt, ctx.now, ctx.timezone)}.`,
  });
  try {
    const outcome = await startProduction(ctx, data.id);
    const message =
      outcome.kind === "session"
        ? "A Claude session is making the video."
        : outcome.kind === "manual"
          ? "Waiting for a Claude session: copy the prompt on the video's page."
          : outcome.kind === "error"
            ? outcome.message
            : null;
    await updateSlot(ctx.db, ws, slot.id, { message });
    bump(counts, "started");
  } catch (e) {
    await updateSlot(ctx.db, ws, slot.id, {
      status: "failed",
      message: (e instanceof Error ? e.message : String(e)).slice(0, 1000),
    });
    bump(counts, "failed");
  }
}

/** The render's facts a routine needs: the session's self-review, cover, caption, hashtags. */
function renderExtras(output: unknown) {
  const o = (output ?? {}) as Record<string, unknown>;
  return {
    review: parseReview(o.review),
    cover: typeof o.cover === "string" ? o.cover : null,
    coverTs: typeof o.cover_t_s === "number" && o.cover_t_s >= 0 ? o.cover_t_s : 0,
    caption: typeof o.caption === "string" ? o.caption : null,
    hashtags: Array.isArray(o.hashtags)
      ? o.hashtags.filter((h): h is string => typeof h === "string")
      : [],
  };
}

/** Copies the session's cover JPEG (an /assets path) to where the scheduler reads covers. */
async function placeCover(
  ctx: BuilderCtx,
  productionId: string,
  versionId: string,
  cover: string | null,
) {
  if (workspaceKindOf(ctx.workspaceId) === "sandbox") return true;
  if (!cover) return false;
  const ref = parseRef(cover, ctx.workspaceId, productionId);
  if (!ref) return false;
  const file = await ctx.db.storage.from(ref.bucket).download(ref.path);
  if (file.error) return false;
  const up = await ctx.db.storage
    .from(VIDEOS_BUCKET)
    .upload(coverPathFor(ctx.workspaceId, versionId), file.data, {
      upsert: true,
      contentType: "image/jpeg",
    });
  return !up.error;
}

/** A building slot whose video moved on: retry, fail, or finish and schedule it. */
async function advanceBuild(
  ctx: BuilderCtx,
  r: RoutineRow,
  slot: Slot,
  counts: Counts,
): Promise<void> {
  const ws = ctx.workspaceId;
  if (!slot.productionId) {
    await updateSlot(ctx.db, ws, slot.id, { status: "failed", message: "Its video was deleted." });
    bump(counts, "failed");
    return;
  }
  let p;
  try {
    p = await getProduction(ctx.db, ws, slot.productionId);
  } catch {
    await updateSlot(ctx.db, ws, slot.id, { status: "failed", message: "Its video was deleted." });
    bump(counts, "failed");
    return;
  }
  const steps = await getSteps(ctx.db, ws, p.id);
  const failed = steps.find((s) => s.status === "failed");
  const waiting = steps.find((s) => s.status === "waiting");
  const render = steps.find((s) => s.step === "render");
  const extras = renderExtras(render?.output);
  const next = nextForBuild({
    productionStatus: p.status,
    failedStep: failed ? { step: failed.step, message: failed.message } : null,
    waitingStep: waiting ? { step: waiting.step, message: waiting.message } : null,
    review: extras.review,
    retries: slot.retries,
  });

  if (next.kind === "wait") {
    if (next.message !== slot.message && next.message)
      await updateSlot(ctx.db, ws, slot.id, { message: next.message });
    return;
  }
  if (next.kind === "scheduled") {
    // Matthew scheduled it himself from the video's page.
    await updateSlot(ctx.db, ws, slot.id, {
      status: "scheduled",
      post_id: p.post_id,
      message: null,
    });
    bump(counts, "scheduled");
    return;
  }
  if (next.kind === "retry") {
    await updateSlot(ctx.db, ws, slot.id, { retries: slot.retries + 1, message: next.note });
    await logEvent(ctx, p.id, { actor: "system", intent: next.note.slice(0, 160) });
    if (isStep(next.step)) await redoFrom(ctx, p.id, next.step, next.note);
    bump(counts, "retried");
    return;
  }
  if (next.kind === "fail") {
    await updateSlot(ctx.db, ws, slot.id, { status: "failed", message: next.message });
    bump(counts, "failed");
    return;
  }

  // Finish: the version chosen for posting gets its pack, cover and checks.
  const versions = await listVersions(ctx.db, ws, p.id);
  const version =
    versions.find((v) => v.media_id && v.media_id === p.media_id) ??
    versions.find((v) => v.media_id);
  if (!version) {
    await updateSlot(ctx.db, ws, slot.id, {
      status: "failed",
      message: "The render has no video file.",
    });
    bump(counts, "failed");
    return;
  }
  try {
    const credits = await videoCredits(ctx.db, ws, p);
    const caption = withCredits(extras.caption ?? p.caption ?? p.title, credits);
    await savePack(ctx, p.id, version.id, { caption, hashtags: extras.hashtags });
    if (!(await placeCover(ctx, p.id, version.id, extras.cover)))
      throw new FactoryError(
        "not_ready",
        "The render sent no cover (output.cover, a JPEG from /assets).",
      );
    await saveCover(ctx, p.id, version.id, extras.coverTs);
    await markReady(ctx, p.id, version.id, { actor: "system" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof FactoryError && slot.retries < 1) {
      const note = `Fix before posting: ${message}`.slice(0, 500);
      await updateSlot(ctx.db, ws, slot.id, { retries: slot.retries + 1, message: note });
      await redoFrom(ctx, p.id, "render", note);
      bump(counts, "retried");
      return;
    }
    await updateSlot(ctx.db, ws, slot.id, {
      status: "failed",
      message: `Not ready to post: ${message}`.slice(0, 1000),
    });
    bump(counts, "failed");
    return;
  }

  if (r.approval === "review") {
    await updateSlot(ctx.db, ws, slot.id, {
      status: "review",
      message: `${versionLabel(version.number)} is ready. Approve it to post ${whenLabel(slot.postAt, ctx.now, ctx.timezone)}.`,
    });
    bump(counts, "review");
    return;
  }
  await scheduleSlot(ctx, slot, p.id, version.id, counts);
}

/** Pins a finished video to its slot (or now, inside the grace time). Too late: missed. */
async function scheduleSlot(
  ctx: BuilderCtx,
  slot: Slot,
  productionId: string,
  versionId: string,
  counts: Counts,
  actor: "matthew" | "system" = "system",
): Promise<void> {
  const at = postTimeFor(slot.postAt, ctx.now);
  if (!at) {
    await updateSlot(ctx.db, ctx.workspaceId, slot.id, {
      status: "missed",
      message: "Ready after its time. The video is still in the Content Factory to post later.",
    });
    bump(counts, "missed");
    return;
  }
  const done = await scheduleVersion(ctx, {
    productionId,
    versionId,
    accountId: slot.accountId,
    timing: { kind: "pinned", at },
    timezone: ctx.timezone,
    actor,
  });
  await updateSlot(ctx.db, ctx.workspaceId, slot.id, {
    status: "scheduled",
    post_id: done.postId,
    message: done.message,
  });
  bump(counts, "scheduled");
}

/** Scheduled slots follow their post: posted, or failed if the post failed or was removed. */
async function syncPosts(ctx: BuilderCtx, slots: readonly Slot[], counts: Counts) {
  const scheduled = slots.flatMap((s) =>
    s.status === "scheduled" && s.postId ? [{ ...s, postId: s.postId }] : [],
  );
  if (!scheduled.length) return;
  const { data, error } = await ctx.db
    .from("posts")
    .select("id, status, last_error")
    .eq("workspace_id", ctx.workspaceId)
    .in(
      "id",
      scheduled.map((s) => s.postId),
    );
  if (error) throw new Error(`Reading the routine's posts failed: ${error.message}`);
  const byId = new Map(data.map((p) => [p.id, p]));
  for (const s of scheduled) {
    const post = byId.get(s.postId);
    let status: SlotStatus | null = null;
    let message: string | null = null;
    if (!post || post.status === "removed") {
      status = "skipped";
      message = "Its post was removed.";
    } else if (post.status === "published") status = "posted";
    else if (post.status === "failed") {
      status = "failed";
      message = post.last_error ?? "Publishing failed.";
    }
    if (status) {
      await updateSlot(ctx.db, ctx.workspaceId, s.id, { status, message });
      bump(counts, status);
    }
  }
}

/** One routine, one step forward. */
export async function advanceRoutine(
  ctx: BuilderCtx,
  routineId: string,
  deadline = Infinity,
): Promise<Counts> {
  const ws = ctx.workspaceId;
  const counts: Counts = {};
  const r = await getRoutine(ctx.db, ws, routineId);
  if (r.status !== "running" && r.status !== "paused") return counts;
  let slots = await getSlots(ctx.db, ws, r.id);

  await syncPosts(ctx, slots, counts);
  for (const s of slots.filter((x) => x.status === "building")) {
    if (Date.now() > deadline) break;
    await advanceBuild(ctx, r, s, counts);
  }
  slots = await getSlots(ctx.db, ws, r.id);
  for (const s of missedSlots(slots, ctx.now)) {
    await updateSlot(ctx.db, ws, s.id, {
      status: "missed",
      message:
        s.status === "planned"
          ? "Its time passed before the video was started."
          : "Not ready in time. The video stays in the Content Factory.",
    });
    bump(counts, "missed");
  }

  if (r.status === "running") {
    slots = await getSlots(ctx.db, ws, r.id);
    const due = slotsToStart({ slots, now: ctx.now, maxParallel: r.max_parallel });
    if (due.length && r.budget_usd !== null) {
      const spent = await routineSpend(ctx.db, ws, r.id);
      if (spent >= r.budget_usd) {
        await updateRoutine(ctx.db, ws, r.id, {
          status: "paused",
          plan_message: `Paused: the routine spent its budget ($${spent.toFixed(2)} of $${r.budget_usd.toFixed(2)}). Raise it to go on.`,
        });
        bump(counts, "paused_budget");
        return counts;
      }
    }
    for (const s of due) {
      if (Date.now() > deadline) break;
      await startSlot(ctx, r, s, counts);
      // In the Sandbox the fake runner finished the video at once: finish it this tick.
      if (workspaceKindOf(ws) === "sandbox") {
        const fresh = (await getSlots(ctx.db, ws, r.id)).find((x) => x.id === s.id);
        if (fresh?.status === "building") await advanceBuild(ctx, r, fresh, counts);
      }
    }
  }

  slots = await getSlots(ctx.db, ws, r.id);
  if (routineFinished(slots)) {
    await updateRoutine(ctx.db, ws, r.id, { status: "done" });
    bump(counts, "routines_done");
  }
  return counts;
}

/** Matthew approves a finished video ("review" routines): it is scheduled at its slot. */
export async function approveSlot(ctx: BuilderCtx, slotId: string): Promise<string> {
  const ws = ctx.workspaceId;
  const { data, error } = await ctx.db
    .from("routine_slots")
    .select("*")
    .eq("workspace_id", ws)
    .eq("id", slotId)
    .maybeSingle();
  if (error || !data) throw new FactoryError("not_found", "That slot doesn't exist.");
  if (data.status !== "review" || !data.production_id)
    throw new FactoryError("not_review", "This video isn't waiting for approval.");
  const p = await getProduction(ctx.db, ws, data.production_id);
  const versions = await listVersions(ctx.db, ws, p.id);
  const version = versions.find((v) => v.media_id && v.media_id === p.media_id);
  if (!version) throw new FactoryError("no_media", "The video has no version to post.");
  const slot = { ...data, postAt: new Date(data.post_at) };
  const at = postTimeFor(slot.postAt, ctx.now);
  // Approved after its time: it goes out at the account's next free slot instead.
  const done = await scheduleVersion(ctx, {
    productionId: p.id,
    versionId: version.id,
    accountId: data.account_id,
    timing: at ? { kind: "pinned", at } : { kind: "next" },
    timezone: ctx.timezone,
  });
  await updateSlot(ctx.db, ws, slotId, {
    status: "scheduled",
    post_id: done.postId,
    message: done.message,
  });
  return done.message;
}

/** Skip a slot that hasn't been scheduled yet (its video, if any, stays in the factory). */
export async function skipSlot(ctx: BuilderCtx, slotId: string): Promise<void> {
  const { data, error } = await ctx.db
    .from("routine_slots")
    .update({ status: "skipped", message: "Skipped by you." })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", slotId)
    .in("status", ["open", "planned", "review", "building"])
    .select("id");
  if (error) throw new Error(`Skipping the slot failed: ${error.message}`);
  if (!data.length) throw new FactoryError("final", "This slot is already scheduled or finished.");
}

/** Cancel: every slot not scheduled yet is skipped. Scheduled posts stay on the canvas. */
export async function cancelRoutine(ctx: BuilderCtx, routineId: string): Promise<void> {
  const ws = ctx.workspaceId;
  const { error } = await ctx.db
    .from("routine_slots")
    .update({ status: "skipped", message: "The routine was cancelled." })
    .eq("workspace_id", ws)
    .eq("routine_id", routineId)
    .in("status", ["open", "planned", "review"]);
  if (error) throw new Error(`Cancelling the routine failed: ${error.message}`);
  await updateRoutine(ctx.db, ws, routineId, { status: "cancelled" });
}

/** The tick step: advances every running (or paused) routine of every workspace. */
export const advanceRoutines: Step = {
  name: "routines",
  async run(tick: TickContext): Promise<StepSummary> {
    let query = tick.db
      .from("routines")
      .select("id, workspace_id")
      .in("status", ["running", "paused"]);
    if (tick.workspaceIds) query = query.in("workspace_id", [...tick.workspaceIds]);
    const { data, error } = await query;
    if (error) throw new Error(`Reading the routines failed: ${error.message}`);
    const summary: Counts = {};
    if (!data.length) return summary;
    const settings = await loadSettings(tick.db, [...new Set(data.map((r) => r.workspace_id))]);
    for (const row of data) {
      if (tick.realNow().getTime() > tick.deadline) {
        bump(summary, "skipped_out_of_time");
        continue;
      }
      const ws = settings.get(row.workspace_id);
      try {
        const counts = await advanceRoutine(
          {
            db: tick.db,
            workspaceId: row.workspace_id,
            now: ws?.now() ?? tick.realNow(),
            timezone: ws?.timezone ?? "UTC",
          },
          row.id,
          tick.deadline,
        );
        for (const [k, v] of Object.entries(counts)) summary[k] = (summary[k] ?? 0) + v;
      } catch (err) {
        console.error(`routines: routine ${row.id} failed:`, err);
        bump(summary, "errors");
      }
    }
    return summary;
  },
};
