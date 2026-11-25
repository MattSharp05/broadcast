"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { nowFor } from "@/lib/clock";
import { createAdminSupabase } from "@/lib/db/admin";
import { isSignedInOwner } from "@/lib/db/auth";
import { FactoryError, getProduction, updateProduction } from "@/lib/db/factory";
import { ContentError, queueContent } from "@/lib/db/posts";
import { currentWorkspace } from "@/lib/db/workspace";
import { addedMessage, localInputToUtc } from "@/lib/domain/content";
import { CAPTION_MAX } from "@/lib/domain/factory/captions";
import { faceModel, isSelectable } from "@/lib/domain/factory/models";
import { isReworkTarget } from "@/lib/domain/factory/rework";
import { isStep, parseModes } from "@/lib/domain/factory/steps";
import { STYLE_PACKS, stylePack } from "@/lib/domain/factory/styles";
import {
  approveStep,
  createProduction,
  redoFrom,
  requestRework,
  startProduction,
  type EngineContext,
  type StartOutcome,
} from "@/lib/factory/engine";
import {
  addNote as addDraftNote,
  deleteNote as deleteDraftNote,
  editNote as editDraftNote,
  logEvent,
  markReady as markPackReady,
  saveCover as savePackCover,
  savePack as savePackText,
  reopenNote as reopenAnsweredNote,
  resolveNote as resolveAnsweredNote,
  sendNotes as sendBatch,
} from "@/lib/factory/studio";
import type { NoteBox, NoteKind } from "@/lib/domain/factory/notes";

/**
 * Content Factory actions. Server actions take whatever the browser sends: every input is checked.
 * They act with the service role on the workspace the dashboard shows, after checking that the
 * signed-in user is the owner.
 */

export type FactoryResult<T = null> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILED = "That didn't work. Check your connection and try again.";

async function engine(): Promise<EngineContext> {
  if (!(await isSignedInOwner())) throw new FactoryError("signed_out", "Sign in again.");
  const workspace = await currentWorkspace();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return {
    db: createAdminSupabase(),
    workspaceId: workspace.id,
    now: nowFor(workspace),
    appUrl: host ? `${proto}://${host}` : undefined,
  };
}

async function guard<T>(fn: () => Promise<T>, id?: string): Promise<FactoryResult<T>> {
  try {
    const value = await fn();
    revalidatePath("/factory");
    if (id) revalidatePath(`/factory/${id}`);
    return { ok: true, value };
  } catch (err) {
    if (err instanceof FactoryError || err instanceof ContentError)
      return { ok: false, error: err.message };
    console.error("Content Factory action failed:", err);
    return { ok: false, error: FAILED };
  }
}

function checkId(id: unknown): string {
  if (typeof id !== "string" || !UUID.test(id)) throw new FactoryError("bad_id", "Unknown video.");
  return id;
}

export async function newVideo(input: { idea?: unknown; remakeOf?: unknown; accountId?: unknown }) {
  return guard(async () => {
    const ctx = await engine();
    const idea = typeof input.idea === "string" ? input.idea.slice(0, 2000) : "";
    const remakeOf = input.remakeOf ? checkId(input.remakeOf) : null;
    const accountId = input.accountId ? checkId(input.accountId) : null;
    return createProduction(ctx, { idea, remakeOf, accountId });
  });
}

/**
 * The studio list's prompt box (BC-42): a new video from one line, started at once. What isn't
 * picked comes from the last video (voice, music, style), else the first in each library; the
 * video page changes everything except the style once started.
 */
export async function startFromPrompt(input: {
  prompt?: unknown;
  accountId?: unknown;
  style?: unknown;
}) {
  return guard(async () => {
    const ctx = await engine();
    const idea = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 2000) : "";
    if (!idea) throw new FactoryError("no_idea", "Say what the video is about first.");
    const accountId = input.accountId ? checkId(input.accountId) : null;
    if (accountId) {
      const a = await ctx.db
        .from("social_accounts")
        .select("id")
        .eq("workspace_id", ctx.workspaceId)
        .eq("id", accountId)
        .maybeSingle();
      if (!a.data) throw new FactoryError("bad_account", "Unknown account.");
    }
    if (input.style && (typeof input.style !== "string" || !stylePack(input.style)))
      throw new FactoryError("bad_style", "Unknown style.");
    const [last, voice, music] = await Promise.all([
      ctx.db
        .from("productions")
        .select("style, voice_key, music_key")
        .eq("workspace_id", ctx.workspaceId)
        .not("voice_key", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      ctx.db.from("factory_voices").select("key").order("sort").limit(1).maybeSingle(),
      ctx.db.from("factory_music").select("key").order("sort").limit(1).maybeSingle(),
    ]);
    const id = await createProduction(ctx, { idea, accountId });
    try {
      await updateProduction(ctx.db, ctx.workspaceId, id, {
        style:
          (typeof input.style === "string" ? input.style : null) ??
          last.data?.style ??
          STYLE_PACKS[0]?.key ??
          null,
        voice_key: last.data?.voice_key ?? voice.data?.key ?? null,
        music_key: last.data?.music_key ?? music.data?.key ?? null,
      });
      const outcome = await startProduction(ctx, id);
      return { id, outcome };
    } catch (err) {
      // Nothing started: no half-made draft is left behind for each retry.
      await ctx.db.from("productions").delete().eq("workspace_id", ctx.workspaceId).eq("id", id);
      throw err;
    }
  });
}

export interface VideoPatch {
  title?: string;
  idea?: string;
  style?: string;
  useAvatar?: boolean;
  avatarId?: string | null;
  faceModel?: string | null;
  voiceKey?: string;
  musicKey?: string;
  accountId?: string | null;
  caption?: string;
}

/** Saves the dashboard-side choices (idea, style, avatar, voice, music, account, caption). */
export async function saveVideo(id: unknown, patch: VideoPatch) {
  const pid = checkId(id);
  return guard(async () => {
    const ctx = await engine();
    const p = await getProduction(ctx.db, ctx.workspaceId, pid);
    const raw = (patch as unknown as Record<string, unknown> | null) ?? {};
    const update: Parameters<typeof updateProduction>[3] = {};
    const started = p.status !== "draft";
    if (typeof raw.title === "string") update.title = raw.title.trim().slice(0, 120);
    if (typeof raw.idea === "string") update.idea = raw.idea.slice(0, 2000);
    if (typeof raw.style === "string") {
      if (!stylePack(raw.style)) throw new FactoryError("bad_style", "Unknown style.");
      if (started && raw.style !== p.style)
        throw new FactoryError(
          "started",
          "The style is set once the video has started. Remake it to change the style.",
        );
      update.style = raw.style;
    }
    if (typeof raw.useAvatar === "boolean") {
      if (started && raw.useAvatar !== p.use_avatar)
        throw new FactoryError("started", "The avatar choice is set once the video has started.");
      update.use_avatar = raw.useAvatar;
      if (!raw.useAvatar) update.avatar_id = null;
    }
    if (raw.avatarId === null || typeof raw.avatarId === "string") {
      if (started && raw.avatarId !== p.avatar_id)
        throw new FactoryError("started", "The avatar is set once the video has started.");
      if (typeof raw.avatarId === "string") {
        checkId(raw.avatarId);
        const a = await ctx.db
          .from("avatars")
          .select("id, current_version")
          .eq("workspace_id", ctx.workspaceId)
          .eq("id", raw.avatarId)
          .maybeSingle();
        if (!a.data) throw new FactoryError("bad_avatar", "Unknown avatar.");
      }
      update.avatar_id = raw.avatarId;
    }
    if (raw.faceModel === null || typeof raw.faceModel === "string") {
      if (typeof raw.faceModel === "string") {
        const m = faceModel(raw.faceModel);
        if (!m || !isSelectable(m))
          throw new FactoryError(
            "bad_model",
            "That model can't be picked (planned models have no adapter yet).",
          );
      }
      update.face_model = raw.faceModel;
    }
    if (typeof raw.voiceKey === "string") {
      const v = await ctx.db
        .from("factory_voices")
        .select("key")
        .eq("key", raw.voiceKey)
        .maybeSingle();
      if (!v.data) throw new FactoryError("bad_voice", "Unknown voice.");
      update.voice_key = raw.voiceKey;
    }
    if (typeof raw.musicKey === "string") {
      const m = await ctx.db
        .from("factory_music")
        .select("key")
        .eq("key", raw.musicKey)
        .maybeSingle();
      if (!m.data) throw new FactoryError("bad_music", "Unknown track.");
      update.music_key = raw.musicKey;
    }
    if (raw.accountId === null || typeof raw.accountId === "string") {
      if (p.post_id)
        throw new FactoryError(
          "posted",
          "This video is already queued. Remake it for another account.",
        );
      if (typeof raw.accountId === "string") {
        checkId(raw.accountId);
        const a = await ctx.db
          .from("social_accounts")
          .select("id")
          .eq("workspace_id", ctx.workspaceId)
          .eq("id", raw.accountId)
          .maybeSingle();
        if (!a.data) throw new FactoryError("bad_account", "Unknown account.");
      }
      update.account_id = raw.accountId;
    }
    if (typeof raw.caption === "string") {
      if (raw.caption.length > CAPTION_MAX)
        throw new FactoryError(
          "caption_too_long",
          `The caption is ${raw.caption.length} characters. Instagram allows ${CAPTION_MAX}.`,
        );
      update.caption = raw.caption;
    }
    if (Object.keys(update).length) await updateProduction(ctx.db, ctx.workspaceId, pid, update);
    return null;
  }, pid);
}

export async function setStepMode(id: unknown, step: unknown, mode: unknown) {
  const pid = checkId(id);
  return guard(async () => {
    if (!isStep(step) || (mode !== "wait" && mode !== "auto"))
      throw new FactoryError("bad_mode", "Unknown step.");
    const ctx = await engine();
    const p = await getProduction(ctx.db, ctx.workspaceId, pid);
    const modes = { ...parseModes(p.step_modes), [step]: mode };
    await updateProduction(ctx.db, ctx.workspaceId, pid, { step_modes: modes });
    return null;
  }, pid);
}

export async function startVideo(id: unknown) {
  const pid = checkId(id);
  return guard<StartOutcome>(async () => startProduction(await engine(), pid), pid);
}

export async function approve(id: unknown, step: unknown) {
  const pid = checkId(id);
  return guard(async () => {
    if (!isStep(step)) throw new FactoryError("bad_step", "Unknown step.");
    const ctx = await engine();
    const outcome = await approveStep(ctx, pid, step);
    await logEvent(ctx, pid, { actor: "matthew", step, intent: `Approved the ${step} step.` });
    return outcome;
  }, pid);
}

export async function redo(id: unknown, step: unknown, note: unknown) {
  const pid = checkId(id);
  return guard(async () => {
    if (!isStep(step)) throw new FactoryError("bad_step", "Unknown step.");
    const text = typeof note === "string" ? note.trim().slice(0, 1000) : "";
    const ctx = await engine();
    const outcome = await redoFrom(ctx, pid, step, text || null);
    await logEvent(ctx, pid, {
      actor: "matthew",
      step,
      intent: text ? `Asked to redo the ${step} step: ${text}` : `Asked to redo the ${step} step.`,
    });
    return outcome;
  }, pid);
}

export async function rework(
  id: unknown,
  input: { target: unknown; ref?: unknown; note?: unknown; quoteUsd?: unknown },
) {
  const pid = checkId(id);
  return guard(async () => {
    if (!isReworkTarget(input.target)) throw new FactoryError("bad_target", "Choose what to redo.");
    const ref =
      typeof input.ref === "string" && input.ref.trim() ? input.ref.trim().slice(0, 60) : null;
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
    const quote = typeof input.quoteUsd === "number" && input.quoteUsd >= 0 ? input.quoteUsd : 0;
    if (input.target === "avatar_slot" && !ref)
      throw new FactoryError("no_slot", "Choose the avatar slot to redo.");
    const ctx = await engine();
    const outcome = await requestRework(ctx, pid, {
      target: input.target,
      ref,
      note,
      quoteUsd: quote,
    });
    await logEvent(ctx, pid, {
      actor: "matthew",
      intent: `Asked to redo ${input.target.replace("_", " ")}${ref ? ` ${ref}` : ""}${note ? `: ${note}` : "."}`,
    });
    return outcome;
  }, pid);
}

/**
 * Sends a version's draft notes to Claude as one batch (BC-36): a revise session starts (the fake
 * runner answers at once in the Sandbox), or the prompt to paste comes back. One open batch at a time.
 */
export async function sendNotes(id: unknown, versionId: unknown) {
  const pid = checkId(id);
  return guard(async () => sendBatch(await engine(), pid, checkId(versionId)), pid);
}

const NOTE_KINDS: readonly NoteKind[] = ["moment", "region", "general"];

function checkBox(box: unknown): NoteBox | null {
  if (!box || typeof box !== "object") return null;
  const b = box as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  return { x: n(b.x), y: n(b.y), w: n(b.w), h: n(b.h) };
}

/** A draft note on a version (the Versions tab): a moment, a region or a general note. */
export async function addNote(
  id: unknown,
  versionId: unknown,
  input: { kind: unknown; tS?: unknown; box?: unknown; text: unknown; cropPath?: unknown },
) {
  const pid = checkId(id);
  return guard(async () => {
    const vid = checkId(versionId);
    if (!NOTE_KINDS.includes(input.kind as NoteKind))
      throw new FactoryError("bad_note", "Unknown kind of note.");
    const tS = typeof input.tS === "number" && Number.isFinite(input.tS) ? input.tS : null;
    return addDraftNote(await engine(), pid, vid, {
      kind: input.kind as NoteKind,
      tS,
      box: checkBox(input.box),
      text: typeof input.text === "string" ? input.text.slice(0, 2000) : "",
      cropPath: typeof input.cropPath === "string" ? input.cropPath : null,
    });
  }, pid);
}

export async function editNote(id: unknown, noteId: unknown, text: unknown) {
  const pid = checkId(id);
  return guard(async () => {
    const t = typeof text === "string" ? text.slice(0, 2000) : "";
    await editDraftNote(await engine(), pid, checkId(noteId), t);
    return null;
  }, pid);
}

export async function deleteNote(id: unknown, noteId: unknown) {
  const pid = checkId(id);
  return guard(async () => {
    await deleteDraftNote(await engine(), pid, checkId(noteId));
    return null;
  }, pid);
}

export async function resolveNote(id: unknown, noteId: unknown) {
  const pid = checkId(id);
  return guard(async () => {
    await resolveAnsweredNote(await engine(), pid, checkId(noteId));
    return null;
  }, pid);
}

export async function reopenNote(id: unknown, noteId: unknown) {
  const pid = checkId(id);
  return guard(async () => reopenAnsweredNote(await engine(), pid, checkId(noteId)), pid);
}

/** The cover frame for a version (the JPEG is already uploaded through /api/factory/{id}/cover). */
export async function saveCover(id: unknown, versionId: unknown, tS: unknown) {
  const pid = checkId(id);
  return guard(async () => {
    const t = typeof tS === "number" && Number.isFinite(tS) && tS >= 0 ? tS : 0;
    await savePackCover(await engine(), pid, checkId(versionId), t);
    return null;
  }, pid);
}

/** A version's caption and hashtags (the Ready to post tab). */
export async function savePack(
  id: unknown,
  versionId: unknown,
  input: { caption: unknown; hashtags: unknown },
) {
  const pid = checkId(id);
  return guard(async () => {
    const caption = typeof input.caption === "string" ? input.caption : "";
    const hashtags = Array.isArray(input.hashtags)
      ? input.hashtags.filter((t): t is string => typeof t === "string").slice(0, 60)
      : [];
    await savePackText(await engine(), pid, checkId(versionId), { caption, hashtags });
    return null;
  }, pid);
}

/** Mark ready: the server runs every check again; refused unless all pass. */
export async function markReady(id: unknown, versionId: unknown) {
  const pid = checkId(id);
  return guard(async () => {
    await markPackReady(await engine(), pid, checkId(versionId));
    return null;
  }, pid);
}

// ── Board (BC-40) ──

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

export async function updateCard(
  id: unknown,
  cardId: unknown,
  patch: { text?: unknown; seconds?: unknown },
) {
  const pid = checkId(id);
  return guard(async () => {
    const { updateCard: update } = await import("@/lib/factory/board");
    await update(await engine(), pid, checkId(cardId), {
      text: typeof patch.text === "string" ? patch.text : undefined,
      seconds: num(patch.seconds),
    });
    return null;
  }, pid);
}

export async function moveCard(id: unknown, cardId: unknown, to: unknown) {
  const pid = checkId(id);
  return guard(async () => {
    const { moveCard: move } = await import("@/lib/factory/board");
    await move(await engine(), pid, checkId(cardId), num(to) ?? 0);
    return null;
  }, pid);
}

export async function deleteCard(id: unknown, cardId: unknown) {
  const pid = checkId(id);
  return guard(async () => {
    const { deleteCard: remove } = await import("@/lib/factory/board");
    await remove(await engine(), pid, checkId(cardId));
    return null;
  }, pid);
}

export async function addCard(id: unknown, input: { text?: unknown; seconds?: unknown }) {
  const pid = checkId(id);
  return guard(async () => {
    const { addCard: add } = await import("@/lib/factory/board");
    await add(await engine(), pid, {
      text: typeof input.text === "string" ? input.text : "",
      seconds: num(input.seconds) ?? 5,
    });
    return null;
  }, pid);
}

export async function approveBoard(id: unknown) {
  const pid = checkId(id);
  return guard(async () => {
    const { approveBoard: approveIt } = await import("@/lib/factory/board");
    return approveIt(await engine(), pid);
  }, pid);
}

export async function redoCard(id: unknown, cardId: unknown, note: unknown) {
  const pid = checkId(id);
  return guard(async () => {
    const text = typeof note === "string" ? note.trim().slice(0, 1000) : "";
    if (!text) throw new FactoryError("no_note", "Say what to change on this card.");
    const { redoCard: redo } = await import("@/lib/factory/board");
    return redo(await engine(), pid, checkId(cardId), text);
  }, pid);
}

/** Queues the finished video on its one account: the next open slot or a pinned time. */
export async function scheduleVideo(
  id: unknown,
  input: { accountId: unknown; timing: { kind: unknown; local?: unknown } },
) {
  const pid = checkId(id);
  return guard(async () => {
    const ctx = await engine();
    const workspace = await currentWorkspace();
    const timezone = workspace.timezone ?? "UTC";
    const p = await getProduction(ctx.db, ctx.workspaceId, pid);
    if (p.post_id)
      throw new FactoryError(
        "posted",
        "This video is already queued. Remake it for another account.",
      );
    if (!p.media_id || p.status !== "ready")
      throw new FactoryError("not_ready", "Approve the render first.");
    const accountId = checkId(input.accountId);
    let timing: { kind: "queue" } | { kind: "pinned"; at: Date };
    if (input.timing.kind === "pinned") {
      const at =
        typeof input.timing.local === "string"
          ? localInputToUtc(input.timing.local, timezone)
          : null;
      if (!at)
        throw new FactoryError("pinned_invalid", "Choose a date and time to pin the post to.");
      timing = { kind: "pinned", at };
    } else timing = { kind: "queue" };
    const caption = p.caption ?? "";
    const queued = await queueContent(ctx.db, {
      workspaceId: ctx.workspaceId,
      timezone,
      now: ctx.now,
      media: null,
      existingMediaId: p.media_id,
      isAiGenerated: p.use_avatar,
      caption,
      accountIds: [accountId],
      timing,
    });
    const post = queued.posts[0];
    await updateProduction(ctx.db, ctx.workspaceId, pid, {
      account_id: accountId,
      post_id: post?.id ?? null,
      status: "scheduled",
    });
    revalidatePath("/workflow");
    return addedMessage(1, post?.scheduledAt ?? null, ctx.now, timezone);
  }, pid);
}

/** Matthew's choice on a hero 3D asset proposal (BC-30). Autopilot never decides these. */
export async function decideHero(
  id: unknown,
  heroId: unknown,
  input: { choice: unknown; model?: unknown; notes?: unknown; reason?: unknown },
) {
  const pid = checkId(id);
  return guard(async () => {
    const hid = checkId(heroId);
    const ctx = await engine();
    const { decide } = await import("@/lib/factory/hero");
    const { workspaceKindOf } = await import("@/lib/db/workspaces");
    return decide(
      {
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        sandbox: workspaceKindOf(ctx.workspaceId) === "sandbox",
        now: ctx.now,
      },
      hid,
      input,
    );
  }, pid);
}
