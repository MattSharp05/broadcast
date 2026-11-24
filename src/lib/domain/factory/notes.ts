/**
 * Review notes and batches (pure, ADR 0008). Matthew pins notes to a version: at a moment, on a
 * region of a frame, or in general. Drafts are sent together as a batch; the session's next version
 * answers the batch, and every sent note gets exactly one answer (changed or not, with a reply).
 */

export type NoteKind = "moment" | "region" | "general";
export type NoteStatus = "draft" | "sent" | "answered" | "not_changed" | "resolved";
export type AnswerStatus = "answered" | "not_changed";
export type BatchStatus = "sent" | "running" | "answered" | "failed";

export const NOTE_TEXT_MAX = 2000;
export const REPLY_MAX = 2000;

/** Normalised 0–1 rectangle on the frame (origin top left). */
export interface NoteBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NoteInput {
  kind: NoteKind;
  text: string;
  tS?: number | null;
  box?: NoteBox | null;
}

const inUnit = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

/** null when the box is a valid normalised rectangle inside the frame, else why not. */
export function boxError(box: unknown): string | null {
  if (typeof box !== "object" || box === null) return "A region note needs a box on the frame.";
  const { x, y, w, h } = box as Record<string, unknown>;
  if (![x, y, w, h].every(inUnit)) return "The box must be x, y, w and h between 0 and 1.";
  const b = { x, y, w, h } as NoteBox;
  if (b.w <= 0 || b.h <= 0) return "The box must have a width and a height.";
  if (b.x + b.w > 1 + 1e-9 || b.y + b.h > 1 + 1e-9) return "The box must fit inside the frame.";
  return null;
}

/**
 * null when the note is valid, else a sentence saying what's wrong. Moment and region notes need a
 * time inside the video; only region notes have a box; general notes have neither.
 */
export function noteError(note: NoteInput, durationS?: number | null): string | null {
  const text = note.text.trim();
  if (!text) return "Write the note first.";
  if (text.length > NOTE_TEXT_MAX) return `Notes can be up to ${NOTE_TEXT_MAX} characters.`;
  const tS = note.tS ?? null;
  const hasTime = tS !== null;
  const hasBox = note.box !== null && note.box !== undefined;

  if (note.kind === "general") {
    if (hasTime) return "A general note isn't pinned to a time.";
    if (hasBox) return "A general note has no box.";
    return null;
  }
  if (tS === null || !Number.isFinite(tS) || tS < 0) {
    return "Pin the note to a time in the video.";
  }
  if (durationS && tS > durationS) return "That time is past the end of the video.";
  if (note.kind === "moment") return hasBox ? "A moment note has no box; use a region note." : null;
  return boxError(note.box);
}

/** The frame shown at t seconds (frames start at 0). */
export function frameAt(tS: number, fps: number): number {
  if (!(fps > 0) || !(tS >= 0)) return 0;
  // The epsilon keeps 2.0 s at 30 fps on frame 60 despite floating point (59.99999…).
  return Math.floor(tS * fps + 1e-6);
}

/** Notes are numbered per version, from 1. */
export function nextNoteNumber(existing: readonly { number: number }[]): number {
  return existing.reduce((max, n) => Math.max(max, n.number), 0) + 1;
}

export interface BatchableNote {
  id: string;
  status: NoteStatus;
}

/** The draft notes to send as one batch, or an error when there's nothing to send. */
export function batchFromDrafts(
  notes: readonly BatchableNote[],
): { ok: true; noteIds: string[] } | { ok: false; error: string } {
  const noteIds = notes.filter((n) => n.status === "draft").map((n) => n.id);
  if (!noteIds.length) return { ok: false, error: "There are no draft notes to send." };
  return { ok: true, noteIds };
}

/** An answer as a session sends it (checked here, so status and reply are untrusted). */
export interface NoteAnswer {
  noteId: string;
  status: string;
  reply: string;
}

export function isAnswerStatus(value: unknown): value is AnswerStatus {
  return value === "answered" || value === "not_changed";
}

export interface SentNote {
  id: string;
  number: number;
}

export type ApplyAnswersResult =
  | { ok: true; updates: { noteId: string; status: AnswerStatus; reply: string }[] }
  | { ok: false; errors: string[] };

/**
 * Matches a session's answers to a batch's sent notes: each sent note must get exactly one answer,
 * `answered` or `not_changed`, with a reply. Any missing, duplicate or unknown answer rejects the
 * whole set (the version isn't accepted as answering the batch).
 */
export function applyAnswers(
  sent: readonly SentNote[],
  answers: readonly NoteAnswer[],
): ApplyAnswersResult {
  const errors: string[] = [];
  const byId = new Map(sent.map((n) => [n.id, n]));
  const seen = new Map<string, NoteAnswer>();

  for (const a of answers) {
    const note = byId.get(a.noteId);
    if (!note) {
      errors.push(`Answer for ${a.noteId}, which isn't a note in this batch.`);
      continue;
    }
    if (seen.has(a.noteId)) {
      errors.push(`Note ${note.number} has more than one answer.`);
      continue;
    }
    seen.set(a.noteId, a);
    if (!isAnswerStatus(a.status)) {
      errors.push(`Note ${note.number}: the answer must be answered or not_changed.`);
    }
    const reply = typeof a.reply === "string" ? a.reply.trim() : "";
    if (!reply) errors.push(`Note ${note.number} needs a reply.`);
    else if (reply.length > REPLY_MAX) {
      errors.push(`Note ${note.number}: replies can be up to ${REPLY_MAX} characters.`);
    }
  }
  for (const n of [...sent].sort((a, b) => a.number - b.number)) {
    if (!seen.has(n.id)) errors.push(`Note ${n.number} has no answer.`);
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    updates: sent.flatMap((n) => {
      const a = seen.get(n.id);
      return a && isAnswerStatus(a.status)
        ? [{ noteId: n.id, status: a.status, reply: a.reply.trim() }]
        : [];
    }),
  };
}
