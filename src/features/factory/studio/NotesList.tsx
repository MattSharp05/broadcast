"use client";

import { Check, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  deleteNote,
  editNote,
  reopenNote,
  resolveNote,
  type FactoryResult,
} from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import { TextArea } from "@/components/TextArea";
import type { NoteView } from "@/lib/db/studio-page";
import { timecode } from "@/lib/domain/factory/player";
import styles from "./studio.module.css";

const STATUS_WORD: Record<NoteView["status"], string> = {
  draft: "Draft",
  sent: "Sent",
  answered: "Answered",
  not_changed: "Not changed",
  resolved: "Resolved",
};

interface NotesListProps {
  videoId: string;
  notes: NoteView[];
  fps: number;
  /** The newest version: an answered note is reopened there. */
  newest: number;
  run: <T>(
    fn: () => Promise<FactoryResult<T>>,
    success?: string | ((v: T) => string | null),
  ) => void;
  pending: boolean;
  onSeek: (t: number) => void;
}

/** The selected version's notes, numbered as on the frame: drafts are editable, answers resolvable. */
export function NotesList({ videoId, notes, fps, newest, run, pending, onSeek }: NotesListProps) {
  if (!notes.length) {
    return (
      <p className={styles.help} data-testid="notes-empty">
        No notes on this version yet. Pause, then click the frame for a moment note or drag a box
        for a region note.
      </p>
    );
  }
  return (
    <ol className={styles.notes} data-testid="notes">
      {notes.map((n) => (
        <NoteItem
          key={n.id}
          videoId={videoId}
          note={n}
          fps={fps}
          newest={newest}
          run={run}
          pending={pending}
          onSeek={onSeek}
        />
      ))}
    </ol>
  );
}

function where(n: NoteView, fps: number): string {
  if (n.kind === "general") return "General";
  const at = timecode(n.tS ?? 0, fps);
  return n.kind === "region" ? `Region at ${at}` : `Moment at ${at}`;
}

function NoteItem({
  videoId,
  note: n,
  fps,
  newest,
  run,
  pending,
  onSeek,
}: Omit<NotesListProps, "notes"> & { note: NoteView }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(n.text);
  const draft = n.status === "draft";
  const answered = n.status === "answered" || n.status === "not_changed";
  return (
    <li className={styles.note} data-testid="note" data-number={n.number} data-status={n.status}>
      <div className={styles.noteHead}>
        <span className={styles.badge}>{n.number}</span>
        {n.tS !== null ? (
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              onSeek(n.tS ?? 0);
            }}
          >
            {where(n, fps)}
          </button>
        ) : (
          <span className={styles.meta}>{where(n, fps)}</span>
        )}
        <span className={styles.grow} />
        <span className={styles.noteStatus} data-status={n.status}>
          {STATUS_WORD[n.status]}
          {n.answeredIn ? ` in v${n.answeredIn}` : ""}
        </span>
      </div>
      {editing ? (
        <div className={styles.noteForm}>
          <TextArea
            className={styles.textarea}
            value={text}
            aria-label={`Note ${n.number}`}
            maxLength={2000}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <div className={styles.row}>
            <Button
              variant="primary"
              disabled={pending || !text.trim()}
              onClick={() => {
                run(() => editNote(videoId, n.id, text));
                setEditing(false);
              }}
            >
              Save note
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setText(n.text);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className={styles.noteText}>{n.text}</p>
      )}
      {n.cropUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.crop} src={n.cropUrl} alt={`The frame note ${n.number} points at`} />
      ) : null}
      {n.reply ? (
        <p className={styles.reply} data-testid="reply">
          {n.reply}
        </p>
      ) : null}
      {draft && !editing ? (
        <div className={styles.row}>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              run(() => deleteNote(videoId, n.id), "Note deleted.");
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        </div>
      ) : null}
      {answered ? (
        <div className={styles.row}>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              run(() => resolveNote(videoId, n.id), "Marked resolved.");
            }}
          >
            <Check aria-hidden="true" />
            Resolve
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              run(
                () => reopenNote(videoId, n.id),
                `Reopened as a draft on v${n.answeredIn ?? newest}.`,
              );
            }}
          >
            <RotateCcw aria-hidden="true" />
            Reopen on v{n.answeredIn ?? newest}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
