import "server-only";
import { FactoryError, fail, getProduction, updateProduction, type Db } from "@/lib/db/factory";
import type { Database, Json } from "@/lib/db/types";
import { VIDEOS_BUCKET } from "@/lib/db/videos";
import { workspaceKindOf } from "@/lib/db/workspaces";
import { FAKE_INTENTS, clipIntent, fakeReply, type EventActor } from "@/lib/domain/factory/events";
import {
  applyAnswers,
  batchFromDrafts,
  frameAt,
  nextNoteNumber,
  noteError,
  type AnswerStatus,
  type NoteAnswer,
  type NoteBox,
  type NoteKind,
} from "@/lib/domain/factory/notes";
import {
  nextVersionNumber,
  pruneSelection,
  versionLabel,
  type VersionMadeBy,
} from "@/lib/domain/factory/versions";
import { parseRef } from "./assets";
import type { EngineContext, StartOutcome } from "./engine";
import { fireRoutine } from "./runner";

/**
 * The studio (BC-36, ADR 0008): every render kept as a numbered version, the activity feed, and
 * review batches (Matthew's notes on a version, answered by the next one). Service-role client;
 * every query is scoped by the workspace id. Nothing here queues or posts.
 */

export type VersionRow = Database["public"]["Tables"]["production_versions"]["Row"];
export type BatchRow = Database["public"]["Tables"]["review_batches"]["Row"];
export type NoteRow = Database["public"]["Tables"]["review_notes"]["Row"];

/** Batches that are still waiting for their answer: one per video at a time. */
export const OPEN_BATCH = ["sent", "running"] as const;

/** Where the fake runner's versions play from in the Sandbox (public sample files). */
export function fakeProxy(number: number): string {
  return `/factory/fake/version-${((number - 1) % 3) + 1}.mp4`;
}
export const FAKE_GIT_SHA = "0000000";

function sandbox(ctx: EngineContext): boolean {
  return workspaceKindOf(ctx.workspaceId) === "sandbox";
}

/** One line in the video's activity feed. An empty intent writes nothing. */
export async function logEvent(
  ctx: EngineContext,
  productionId: string,
  e: { actor: EventActor; intent: unknown; step?: string | null; sessionUrl?: string | null },
): Promise<void> {
  const intent = clipIntent(e.intent);
  if (!intent) return;
  const { error } = await ctx.db.from("production_events").insert({
    workspace_id: ctx.workspaceId,
    production_id: productionId,
    actor: e.actor,
    step: e.step ?? null,
    intent,
    session_url: e.sessionUrl ?? null,
    // The database's clock, not the Sandbox's: the feed keeps the order things happened in.
  });
  if (error) fail("saving the activity", error);
}

/** A session's intent on a step call, with that step's session link. */
export async function logSessionIntent(
  ctx: EngineContext,
  productionId: string,
  step: string,
  intent: unknown,
): Promise<void> {
  if (!clipIntent(intent)) return;
  const [row, p] = await Promise.all([
    step === "revise"
      ? Promise.resolve({ data: null })
      : ctx.db
          .from("production_steps")
          .select("session_url")
          .eq("workspace_id", ctx.workspaceId)
          .eq("production_id", productionId)
          .eq("step", step as never)
          .maybeSingle(),
    getProduction(ctx.db, ctx.workspaceId, productionId),
  ]);
  await logEvent(ctx, productionId, {
    actor: "session",
    step,
    intent,
    sessionUrl: row.data?.session_url ?? p.session_url,
  });
}

export async function listVersions(db: Db, ws: string, productionId: string) {
  const { data, error } = await db
    .from("production_versions")
    .select("*")
    .eq("workspace_id", ws)
    .eq("production_id", productionId)
    .order("number", { ascending: false });
  if (error) fail("reading the versions", error);
  return data;
}

export interface NewVersion {
  mediaId: string | null;
  proxyPath?: string | null;
  gitSha: string;
  madeBy: VersionMadeBy;
  batchId?: string | null;
  intent?: unknown;
  durationS?: number | null;
  fps?: number | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  loudnessLufs?: number | null;
  truePeakDb?: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Adds the next numbered version. It becomes the video's version for posting unless one is
 * already posted or scheduled. Older drafts are pruned afterwards.
 */
export async function addVersion(
  ctx: EngineContext,
  productionId: string,
  v: NewVersion,
): Promise<{ id: string; number: number }> {
  const ws = ctx.workspaceId;
  let inserted: { id: string; number: number } | null = null;
  let first = false;
  // Two renders landing at once can pick the same number: the unique index refuses one; retry.
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    const existing = await listVersions(ctx.db, ws, productionId);
    first = existing.length === 0;
    const number = nextVersionNumber(existing);
    const { data, error } = await ctx.db
      .from("production_versions")
      .insert({
        workspace_id: ws,
        production_id: productionId,
        number,
        media_id: v.mediaId,
        proxy_path: v.proxyPath ?? null,
        git_sha: v.gitSha,
        made_by: v.madeBy,
        batch_id: v.batchId ?? null,
        intent: clipIntent(v.intent) ?? "",
        duration_s: num(v.durationS),
        fps: num(v.fps),
        width: num(v.width),
        height: num(v.height),
        bytes: num(v.bytes),
        loudness_lufs: num(v.loudnessLufs),
        true_peak_db: num(v.truePeakDb),
        created_at: ctx.now.toISOString(),
      })
      .select("id, number")
      .single();
    if (!error) inserted = data;
    else if (error.code !== "23505") fail("saving the version", error);
  }
  if (!inserted) throw new FactoryError("version_race", "Two versions arrived at once. Try again.");

  const p = await getProduction(ctx.db, ws, productionId);
  if (v.mediaId && !p.post_id) {
    // A render from before versions existed has no row to prune: it goes now, as it used to.
    if (first && p.media_id && p.media_id !== v.mediaId) {
      const old = await mediaPath(ctx.db, ws, p.media_id);
      await updateProduction(ctx.db, ws, productionId, { media_id: v.mediaId });
      await removeFile(ctx.db, ws, old);
      await ctx.db.from("media_assets").delete().eq("workspace_id", ws).eq("id", p.media_id);
    } else {
      await updateProduction(ctx.db, ws, productionId, { media_id: v.mediaId });
    }
  }
  await pruneVersions(ctx, productionId);
  return inserted;
}

/** Removes a stored file given as a storage ref, a videos-bucket path, or a public URL (kept). */
async function removeFile(db: Db, ws: string, value: string | null): Promise<void> {
  if (!value) return;
  let bucket = VIDEOS_BUCKET;
  let path = value;
  if (value.startsWith("storage:")) {
    const ref = parseRef(value, ws);
    if (!ref) return;
    bucket = ref.bucket;
    path = ref.path;
  } else if (!value.startsWith(`${ws}/`)) {
    return; // A sample file or a URL: nothing of ours to delete.
  }
  // Best effort: a file that's already gone is fine.
  await db.storage.from(bucket).remove([path]);
}

/**
 * Storage policy (ADR 0008, `pruneSelection`): posted and chosen versions keep everything, the
 * newest other keeps its full file, the newest 3 others keep their proxy; the rest are cleared.
 */
export async function pruneVersions(ctx: EngineContext, productionId: string): Promise<number[]> {
  const ws = ctx.workspaceId;
  const [versions, p] = await Promise.all([
    listVersions(ctx.db, ws, productionId),
    getProduction(ctx.db, ws, productionId),
  ]);
  const mediaIds = versions.map((v) => v.media_id).filter((m): m is string => Boolean(m));
  const posted = new Set<string>();
  if (mediaIds.length) {
    const { data, error } = await ctx.db
      .from("posts")
      .select("media_id")
      .eq("workspace_id", ws)
      .in("media_id", mediaIds);
    if (error) fail("reading the posts", error);
    for (const r of data) if (r.media_id) posted.add(r.media_id);
  }
  const actions = pruneSelection(
    versions.map((v) => ({
      id: v.id,
      number: v.number,
      mediaId: v.media_id,
      proxyPath: v.proxy_path,
      posted: v.media_id !== null && posted.has(v.media_id),
      chosen: v.media_id !== null && v.media_id === p.media_id,
    })),
  );
  const pruned: number[] = [];
  for (const a of actions) {
    const v = versions.find((x) => x.id === a.id);
    if (!v) continue;
    const media = a.media && v.media_id ? await mediaPath(ctx.db, ws, v.media_id) : null;
    const { error } = await ctx.db
      .from("production_versions")
      .update({
        pruned_at: v.pruned_at ?? ctx.now.toISOString(),
        ...(a.media ? { media_id: null } : {}),
        ...(a.proxy ? { proxy_path: null } : {}),
      })
      .eq("workspace_id", ws)
      .eq("id", v.id);
    if (error) fail("pruning a version", error);
    if (a.proxy) await removeFile(ctx.db, ws, v.proxy_path);
    if (a.media && v.media_id) {
      await removeFile(ctx.db, ws, media);
      await ctx.db.from("media_assets").delete().eq("workspace_id", ws).eq("id", v.media_id);
    }
    pruned.push(v.number);
  }
  if (pruned.length) {
    await logEvent(ctx, productionId, {
      actor: "system",
      intent: `Cleared older drafts to save space: ${pruned.map(versionLabel).join(", ")} (each can be rebuilt from its git sha).`,
    });
  }
  return pruned;
}

async function mediaPath(db: Db, ws: string, mediaId: string): Promise<string | null> {
  const { data } = await db
    .from("media_assets")
    .select("storage_path")
    .eq("workspace_id", ws)
    .eq("id", mediaId)
    .maybeSingle();
  return data?.storage_path ?? null;
}

export async function openBatch(db: Db, ws: string, productionId: string) {
  const { data, error } = await db
    .from("review_batches")
    .select("*")
    .eq("workspace_id", ws)
    .eq("production_id", productionId)
    .in("status", [...OPEN_BATCH])
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("reading the open batch", error);
  return data;
}

async function getVersion(db: Db, ws: string, productionId: string, versionId: string) {
  const { data, error } = await db
    .from("production_versions")
    .select("*")
    .eq("workspace_id", ws)
    .eq("production_id", productionId)
    .eq("id", versionId)
    .maybeSingle();
  if (error) fail("reading the version", error);
  if (!data) throw new FactoryError("not_found", "That version isn't part of this video.");
  return data;
}

export async function notesOfBatch(db: Db, ws: string, batchId: string): Promise<NoteRow[]> {
  const { data, error } = await db
    .from("review_notes")
    .select("*")
    .eq("workspace_id", ws)
    .eq("batch_id", batchId)
    .order("number");
  if (error) fail("reading the batch's notes", error);
  return data;
}

/**
 * Send notes: the version's draft notes become one batch, and a session is started with
 * STEP=revise and BATCH=<id> (the fake runner answers at once in the Sandbox). One open batch per
 * video at a time.
 */
export async function sendNotes(
  ctx: EngineContext,
  productionId: string,
  versionId: string,
): Promise<StartOutcome & { batchId: string }> {
  const ws = ctx.workspaceId;
  const version = await getVersion(ctx.db, ws, productionId, versionId);
  if (await openBatch(ctx.db, ws, productionId)) {
    throw new FactoryError(
      "batch_open",
      "A batch of notes is already with Claude. Wait for its answer before sending more.",
    );
  }
  const { data: drafts, error: draftsError } = await ctx.db
    .from("review_notes")
    .select("id, status")
    .eq("workspace_id", ws)
    .eq("version_id", version.id)
    .eq("status", "draft");
  if (draftsError) fail("reading the draft notes", draftsError);
  const picked = batchFromDrafts(drafts.map((d) => ({ id: d.id, status: "draft" as const })));
  if (!picked.ok) throw new FactoryError("no_drafts", picked.error);

  const { data: batch, error } = await ctx.db
    .from("review_batches")
    .insert({
      workspace_id: ws,
      production_id: productionId,
      version_id: version.id,
      status: "sent",
      sent_at: ctx.now.toISOString(),
    })
    .select("*")
    .single();
  if (error) {
    // The partial unique index (if any) or a race: another batch just opened.
    if (error.code === "23505")
      throw new FactoryError("batch_open", "A batch of notes is already with Claude.");
    fail("saving the batch", error);
  }
  // Anything that fails from here puts the notes back to drafts, so they can be sent again.
  const rollback = async () => {
    await ctx.db
      .from("review_batches")
      .update({ status: "failed" })
      .eq("workspace_id", ws)
      .eq("id", batch.id);
    const { error: undoError } = await ctx.db
      .from("review_notes")
      .update({ status: "draft", batch_id: null })
      .eq("workspace_id", ws)
      .in("id", picked.noteIds);
    if (undoError) console.error("Putting the notes back to drafts failed:", undoError.message);
  };
  try {
    return await startBatch(
      ctx,
      productionId,
      batch,
      version.number,
      picked.noteIds.length,
      rollback,
    );
  } catch (err) {
    await rollback();
    throw err;
  }
}

async function startBatch(
  ctx: EngineContext,
  productionId: string,
  batch: BatchRow,
  versionNumber: number,
  n: number,
  rollback: () => Promise<void>,
): Promise<StartOutcome & { batchId: string }> {
  const ws = ctx.workspaceId;
  const { error: notesError } = await ctx.db
    .from("review_notes")
    .update({ status: "sent", batch_id: batch.id })
    .eq("workspace_id", ws)
    .eq("version_id", batch.version_id)
    .eq("status", "draft");
  if (notesError) fail("sending the notes", notesError);
  await logEvent(ctx, productionId, {
    actor: "matthew",
    step: "revise",
    intent: `Sent ${n} ${n === 1 ? "note" : "notes"} on ${versionLabel(versionNumber)}.`,
  });

  if (sandbox(ctx)) {
    await fakeRevise(ctx, productionId, batch);
    return { kind: "fake", batchId: batch.id };
  }

  const { mintFactoryToken } = await import("./engine");
  const token = await mintFactoryToken(ctx, productionId);
  const { configuredAppOrigin } = await import("@/lib/app-url");
  const appUrl = ctx.appUrl ?? configuredAppOrigin() ?? "http://localhost:3000";
  const result = await fireRoutine({
    productionId,
    step: "revise",
    appUrl,
    token,
    note: null,
    batchId: batch.id,
  });
  if (result.kind === "session") {
    await ctx.db
      .from("review_batches")
      .update({ status: "running", session_id: result.sessionId, session_url: result.sessionUrl })
      .eq("workspace_id", ws)
      .eq("id", batch.id);
    await logEvent(ctx, productionId, {
      actor: "system",
      step: "revise",
      intent: "Session started on the notes.",
      sessionUrl: result.sessionUrl,
    });
    return { kind: "session", sessionUrl: result.sessionUrl, batchId: batch.id };
  }
  if (result.kind === "manual") return { ...result, batchId: batch.id };
  // Nothing started: the batch failed and its notes go back to drafts, to send again.
  await rollback();
  return { kind: "error", message: result.message, batchId: batch.id };
}

/** A batch a session answers: its sent notes, checked against the answers before anything is saved. */
export interface PreparedRevision {
  batch: BatchRow;
  updates: { noteId: string; status: AnswerStatus; reply: string }[];
}

/**
 * Checks a revise session's batch and answers. Throws FactoryError `wrong_batch` (another video's
 * batch, or none), `batch_closed` (already answered or failed) or `answers_incomplete` (with every
 * problem in the message).
 */
export async function prepareRevision(
  ctx: EngineContext,
  productionId: string,
  batchId: string,
  answers: NoteAnswer[],
): Promise<PreparedRevision> {
  const ws = ctx.workspaceId;
  const { data: batch, error } = await ctx.db
    .from("review_batches")
    .select("*")
    .eq("workspace_id", ws)
    .eq("id", batchId)
    .maybeSingle();
  if (error) fail("reading the batch", error);
  if (batch?.production_id !== productionId) {
    throw new FactoryError("wrong_batch", "That batch belongs to another video.");
  }
  if (!OPEN_BATCH.includes(batch.status as (typeof OPEN_BATCH)[number])) {
    throw new FactoryError("batch_closed", `That batch is ${batch.status}, not open.`);
  }
  const notes = await notesOfBatch(ctx.db, ws, batch.id);
  const checked = applyAnswers(
    notes.filter((n) => n.status === "sent").map((n) => ({ id: n.id, number: n.number })),
    answers,
  );
  if (!checked.ok) throw new FactoryError("answers_incomplete", checked.errors.join(" "));
  return { batch, updates: checked.updates };
}

/** Saves the answering version, each note's verdict and reply, and closes the batch. */
export async function applyRevision(
  ctx: EngineContext,
  productionId: string,
  prepared: PreparedRevision,
  version: Omit<NewVersion, "madeBy" | "batchId">,
): Promise<{ id: string; number: number }> {
  const ws = ctx.workspaceId;
  // Read before the new version prunes anything.
  await copyRecipe(ctx, prepared.batch.version_id, version.mediaId);
  // Close the batch first, only if it is still open: a retried or doubled call answers it once.
  const { data: closed, error: closeError } = await ctx.db
    .from("review_batches")
    .update({ status: "answered" })
    .eq("workspace_id", ws)
    .eq("id", prepared.batch.id)
    .in("status", [...OPEN_BATCH])
    .select("id");
  if (closeError) fail("closing the batch", closeError);
  if (!closed.length) throw new FactoryError("batch_closed", "That batch was already answered.");
  let created: { id: string; number: number };
  try {
    created = await addVersion(ctx, productionId, {
      ...version,
      madeBy: "revise",
      batchId: prepared.batch.id,
    });
  } catch (err) {
    await ctx.db
      .from("review_batches")
      .update({ status: prepared.batch.status })
      .eq("workspace_id", ws)
      .eq("id", prepared.batch.id);
    throw err;
  }
  for (const u of prepared.updates) {
    const { error } = await ctx.db
      .from("review_notes")
      .update({ status: u.status, reply: u.reply, answered_in_version: created.id })
      .eq("workspace_id", ws)
      .eq("id", u.noteId);
    if (error) fail("saving an answer", error);
  }
  const { error } = await ctx.db
    .from("review_batches")
    .update({ answered_by_version: created.id })
    .eq("workspace_id", ws)
    .eq("id", prepared.batch.id);
  if (error) fail("closing the batch", error);
  await logEvent(ctx, productionId, {
    actor: "session",
    step: "revise",
    intent: version.intent ?? `Answered the notes in ${versionLabel(created.number)}.`,
    sessionUrl: prepared.batch.session_url,
  });
  return created;
}

/** A revised version keeps the recipe of the version its notes were on (style, voice, music…). */
async function copyRecipe(ctx: EngineContext, fromVersionId: string, mediaId: string | null) {
  if (!mediaId) return;
  const ws = ctx.workspaceId;
  const { data: from } = await ctx.db
    .from("production_versions")
    .select("media_id")
    .eq("workspace_id", ws)
    .eq("id", fromVersionId)
    .maybeSingle();
  const recipe = from?.media_id
    ? (
        await ctx.db
          .from("media_assets")
          .select("recipe")
          .eq("workspace_id", ws)
          .eq("id", from.media_id)
          .maybeSingle()
      ).data?.recipe
    : null;
  if (!recipe) return;
  const { error } = await ctx.db
    .from("media_assets")
    .update({ recipe })
    .eq("workspace_id", ws)
    .eq("id", mediaId);
  if (error) fail("saving the recipe", error);
}

/** The fake runner's revise: a new version at once (the previous file), a canned reply per note. */
async function fakeRevise(ctx: EngineContext, productionId: string, batch: BatchRow) {
  const ws = ctx.workspaceId;
  await logEvent(ctx, productionId, {
    actor: "session",
    step: "revise",
    intent: FAKE_INTENTS.revise,
  });
  const notes = await notesOfBatch(ctx.db, ws, batch.id);
  const prepared = await prepareRevision(
    ctx,
    productionId,
    batch.id,
    notes.map((n) => ({ noteId: n.id, status: "answered", reply: fakeReply(n.number, n.text) })),
  );
  const prev = await getVersion(ctx.db, ws, productionId, batch.version_id);
  const versions = await listVersions(ctx.db, ws, productionId);
  const number = nextVersionNumber(versions);
  const media = await fakeVersionMedia(ctx, productionId, number, prev);
  await applyRevision(ctx, productionId, prepared, {
    mediaId: media,
    proxyPath: fakeProxy(number),
    gitSha: FAKE_GIT_SHA,
    intent: `Answered ${notes.length} ${notes.length === 1 ? "note" : "notes"} in ${versionLabel(number)}.`,
    durationS: prev.duration_s,
    fps: prev.fps ?? 30,
    width: prev.width,
    height: prev.height,
    bytes: prev.bytes,
    loudnessLufs: prev.loudness_lufs,
    truePeakDb: prev.true_peak_db,
  });
}

/** A media row for a fake version (Sandbox: the file is never read). */
export async function fakeVersionMedia(
  ctx: EngineContext,
  productionId: string,
  number: number,
  like: Pick<VersionRow, "duration_s" | "width" | "height" | "bytes"> | null,
): Promise<string> {
  const { data, error } = await ctx.db
    .from("media_assets")
    .insert({
      workspace_id: ctx.workspaceId,
      storage_path: `${ctx.workspaceId}/videos/factory-${productionId}-v${number}.mp4`,
      duration_s: like?.duration_s ?? 60,
      width: like?.width ?? 1080,
      height: like?.height ?? 1920,
      bytes: like?.bytes ?? 12_000_000,
    })
    .select("id")
    .single();
  if (error) fail("saving the fake version", error);
  return data.id;
}

// ───────────────────────────── notes (the Versions tab, BC-37) ─────────────────────────────

export interface NoteDraft {
  kind: NoteKind;
  tS: number | null;
  box: NoteBox | null;
  text: string;
  cropPath: string | null;
}

async function getNote(db: Db, ws: string, productionId: string, noteId: string) {
  const { data, error } = await db
    .from("review_notes")
    .select("*")
    .eq("workspace_id", ws)
    .eq("production_id", productionId)
    .eq("id", noteId)
    .maybeSingle();
  if (error) fail("reading the note", error);
  if (!data) throw new FactoryError("not_found", "That note isn't on this video.");
  return data;
}

/** A draft note on a version, numbered after the version's last note (numbers stay stable). */
export async function addNote(
  ctx: EngineContext,
  productionId: string,
  versionId: string,
  draft: NoteDraft,
): Promise<{ id: string; number: number }> {
  const ws = ctx.workspaceId;
  const version = await getVersion(ctx.db, ws, productionId, versionId);
  const tS = draft.kind === "general" ? null : draft.tS;
  const box = draft.kind === "region" ? draft.box : null;
  const problem = noteError({ kind: draft.kind, text: draft.text, tS, box }, version.duration_s);
  if (problem) throw new FactoryError("bad_note", problem);
  if (draft.cropPath && !parseRef(draft.cropPath, ws, productionId)) {
    throw new FactoryError("bad_crop", "That frame image isn't this video's.");
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: existing, error: readError } = await ctx.db
      .from("review_notes")
      .select("number")
      .eq("workspace_id", ws)
      .eq("version_id", version.id);
    if (readError) fail("reading the notes", readError);
    const number = nextNoteNumber(existing);
    const { data, error } = await ctx.db
      .from("review_notes")
      .insert({
        workspace_id: ws,
        production_id: productionId,
        version_id: version.id,
        number,
        kind: draft.kind,
        t_s: tS,
        frame: tS === null ? null : frameAt(tS, version.fps ?? 30),
        box: box as unknown as Json,
        text: draft.text.trim(),
        crop_path: draft.cropPath,
      })
      .select("id, number")
      .single();
    if (!error) return data;
    if (error.code !== "23505") fail("saving the note", error);
  }
  throw new FactoryError("note_race", "Two notes arrived at once. Try again.");
}

async function draftNote(ctx: EngineContext, productionId: string, noteId: string) {
  const note = await getNote(ctx.db, ctx.workspaceId, productionId, noteId);
  if (note.status !== "draft") {
    throw new FactoryError("sent", "This note was sent to Claude, so it can't be changed now.");
  }
  return note;
}

export async function editNote(
  ctx: EngineContext,
  productionId: string,
  noteId: string,
  text: string,
): Promise<void> {
  const note = await draftNote(ctx, productionId, noteId);
  const problem = noteError({
    kind: note.kind as NoteKind,
    text,
    tS: note.t_s,
    box: note.box as NoteBox | null,
  });
  if (problem) throw new FactoryError("bad_note", problem);
  const { error } = await ctx.db
    .from("review_notes")
    .update({ text: text.trim() })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", note.id)
    .eq("status", "draft");
  if (error) fail("saving the note", error);
}

export async function deleteNote(
  ctx: EngineContext,
  productionId: string,
  noteId: string,
): Promise<void> {
  const note = await draftNote(ctx, productionId, noteId);
  const { error } = await ctx.db
    .from("review_notes")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", note.id)
    .eq("status", "draft");
  if (error) fail("deleting the note", error);
  await removeFile(ctx.db, ctx.workspaceId, note.crop_path);
}

/** Matthew is happy with the answer. */
export async function resolveNote(
  ctx: EngineContext,
  productionId: string,
  noteId: string,
): Promise<void> {
  const note = await getNote(ctx.db, ctx.workspaceId, productionId, noteId);
  if (note.status !== "answered" && note.status !== "not_changed") {
    throw new FactoryError("not_answered", "Only an answered note can be resolved.");
  }
  const { error } = await ctx.db
    .from("review_notes")
    .update({ status: "resolved" })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", note.id);
  if (error) fail("resolving the note", error);
}

/** Not happy: the same note again, as a new draft on the version that answered it. */
export async function reopenNote(
  ctx: EngineContext,
  productionId: string,
  noteId: string,
): Promise<{ id: string; number: number }> {
  const note = await getNote(ctx.db, ctx.workspaceId, productionId, noteId);
  if (!note.answered_in_version) {
    throw new FactoryError("not_answered", "Only an answered note can be reopened.");
  }
  const target = await getVersion(ctx.db, ctx.workspaceId, productionId, note.answered_in_version);
  return addNote(ctx, productionId, target.id, {
    kind: note.kind as NoteKind,
    tS: note.kind === "general" ? null : Math.min(note.t_s ?? 0, target.duration_s ?? Infinity),
    box: (note.box as NoteBox | null) ?? null,
    text: note.text,
    cropPath: null,
  });
}
