"use client";

import { MessageSquarePlus, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { addNote, sendNotes } from "@/app/(app)/factory/actions";
import { Button, ButtonLink } from "@/components/Button";
import { TextArea } from "@/components/TextArea";
import type { NoteBox, NoteKind } from "@/lib/domain/factory/notes";
import { cropRect, cropSize, timecode } from "@/lib/domain/factory/player";
import { PromptBox } from "../PipelineSection";
import { ActivityFeed } from "./ActivityFeed";
import { NotesList } from "./NotesList";
import { Player, type Gesture } from "./Player";
import type { StudioTabProps } from "./tabs";
import styles from "./studio.module.css";

/** How often the page refreshes while a batch is open or a step runs. */
const POLL_MS = 5000;

interface Draft {
  kind: NoteKind;
  tS: number | null;
  box: NoteBox | null;
}

/**
 * The Versions tab (BC-37): watch a version, pin notes to moments and regions of the frame, send
 * them as one batch, and read each answer in the next version. The activity feed sits beside it.
 */
export function VersionsTab({ video, studio, run, notify, pending }: StudioTabProps) {
  const router = useRouter();
  const versions = studio.versions;
  const newest = versions[0];
  const [selectedId, setSelectedId] = useState(newest?.id ?? null);
  const [time, setTime] = useState(0);
  const [sameMoment, setSameMoment] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState<{ prompt: string; reason: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const selected = versions.find((v) => v.id === selectedId) ?? newest;
  // A new version (the answer) arrives: show it.
  const newestId = newest?.id;
  const [seenNewest, setSeenNewest] = useState(newestId);
  if (newestId !== seenNewest) {
    setSeenNewest(newestId);
    setSelectedId(newestId ?? null);
  }

  useEffect(() => {
    if (!studio.live) return;
    const t = setInterval(() => {
      router.refresh();
    }, POLL_MS);
    return () => {
      clearInterval(t);
    };
  }, [studio.live, router]);

  const onTime = useCallback((t: number) => {
    setTime(t);
  }, []);

  if (!selected) {
    return (
      <div className={styles.empty} data-testid="no-versions">
        <h2>No versions yet</h2>
        <p className={styles.help}>
          Each render becomes a numbered version here, once the render step has run on the Make tab.
        </p>
      </div>
    );
  }

  const notes = studio.notes.filter((n) => n.versionId === selected.id);
  const drafts = notes.filter((n) => n.status === "draft").length;
  const open = studio.openBatch;

  const startNote = (g: Gesture | { kind: "general" }) => {
    setDraft(
      g.kind === "general"
        ? { kind: "general", tS: null, box: null }
        : { kind: g.kind, tS: g.tS, box: g.kind === "region" ? g.box : null },
    );
    setText("");
  };

  const saveNote = async () => {
    if (!draft) return;
    setSaving(true);
    const cropPath = await uploadCrop(video.id, videoRef.current, draft);
    const res = await addNote(video.id, selected.id, { ...draft, text, cropPath });
    setSaving(false);
    if (!res.ok) {
      notify(res.error, "error");
      return;
    }
    setDraft(null);
    setText("");
    router.refresh();
  };

  return (
    <div className={styles.versions}>
      <div className={styles.main}>
        <div className={styles.switcher} role="radiogroup" aria-label="Versions">
          {versions.map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={v.id === selected.id}
              className={styles.versionChip}
              data-version={v.number}
              onClick={() => {
                setSelectedId(v.id);
                setDraft(null);
                if (!sameMoment) setTime(0);
              }}
              title={v.intent}
            >
              <strong>v{v.number}</strong>
              <span className={styles.meta}>
                {v.when}, {v.madeBy === "revise" ? "revised" : v.madeBy}
              </span>
            </button>
          ))}
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={sameMoment}
            onChange={(e) => {
              setSameMoment(e.target.checked);
            }}
          />
          Same moment in other versions
        </label>
        {selected.intent ? (
          <p className={styles.help} data-testid="version-intent">
            v{selected.number}: {selected.intent}
          </p>
        ) : null}

        <div className={styles.review}>
          <Player
            key={selected.id}
            version={selected}
            notes={notes}
            time={time}
            onTime={onTime}
            onGesture={startNote}
            pendingBox={draft?.box ?? null}
            videoRef={videoRef}
          />

          <section className={styles.notesPanel} aria-labelledby="notes-h">
            <div className={styles.sectionHead}>
              <h2 id="notes-h">Notes on v{selected.number}</h2>
              <span className={styles.grow} />
              <Button
                variant="ghost"
                disabled={pending || Boolean(draft)}
                onClick={() => {
                  startNote({ kind: "general" });
                }}
              >
                <MessageSquarePlus aria-hidden="true" />
                General note
              </Button>
            </div>

            {draft ? (
              <form
                className={styles.noteForm}
                data-testid="note-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveNote();
                }}
              >
                <span className={styles.meta}>
                  {draft.kind === "general"
                    ? "New general note"
                    : `New ${draft.kind} note at ${timecode(draft.tS ?? 0, selected.fps)}`}
                </span>
                <TextArea
                  className={styles.textarea}
                  value={text}
                  autoFocus
                  aria-label="Note"
                  maxLength={2000}
                  placeholder={
                    draft.kind === "region"
                      ? "What should change in this box?"
                      : "What should change?"
                  }
                  onChange={(e) => {
                    setText(e.target.value);
                  }}
                />
                <div className={styles.row}>
                  <Button type="submit" variant="primary" disabled={saving || !text.trim()}>
                    Add note
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDraft(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}

            <NotesList
              videoId={video.id}
              notes={notes}
              fps={selected.fps}
              newest={newest?.number ?? selected.number}
              run={run}
              pending={pending}
              onSeek={(t) => {
                setTime(t);
              }}
            />

            <div className={styles.sendRow}>
              <Button
                variant="primary"
                disabled={pending || drafts === 0 || Boolean(open)}
                onClick={() => {
                  run(
                    () => sendNotes(video.id, selected.id),
                    (o) => {
                      if (o.kind === "manual") {
                        setPrompt({ prompt: o.prompt, reason: o.reason });
                        return null;
                      }
                      if (o.kind === "error") {
                        notify(o.message, "error");
                        return null;
                      }
                      return o.kind === "fake"
                        ? "Notes answered (Sandbox)."
                        : "Notes sent. A Claude session started.";
                    },
                  );
                }}
              >
                <Send aria-hidden="true" />
                Send notes ({drafts})
              </Button>
              {open ? (
                <span className={styles.meta} data-testid="batch-open">
                  {open.noteCount} {open.noteCount === 1 ? "note is" : "notes are"} with Claude.
                  {open.sessionUrl ? (
                    <>
                      {" "}
                      <a href={open.sessionUrl} target="_blank" rel="noreferrer">
                        Watch the session
                      </a>
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
            {prompt ? <PromptBox prompt={prompt} notify={notify} /> : null}
          </section>
        </div>
      </div>
      <aside className={styles.rail}>
        <ActivityFeed events={studio.events} />
        {video.sessionUrl ? (
          <ButtonLink href={video.sessionUrl} target="_blank" rel="noreferrer" variant="ghost">
            Watch the latest session
          </ButtonLink>
        ) : null}
      </aside>
    </div>
  );
}

/**
 * The frame the note points at, as seen in the player: the box (or the whole frame) as a JPEG of
 * at most 1280 px wide, uploaded through a signed URL. Best effort: a frame the browser can't read
 * (not loaded yet, or another origin without CORS) leaves the note without a crop.
 */
async function uploadCrop(
  videoId: string,
  v: HTMLVideoElement | null,
  draft: Draft,
): Promise<string | null> {
  if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return null;
  try {
    const r = cropRect(draft.box, v.videoWidth, v.videoHeight);
    const size = cropSize(r.sw, r.sh);
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, size.w, size.h);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.85);
    });
    if (!blob) return null;
    const asked = await fetch(`/api/factory/${videoId}/notes/crop`, { method: "POST" });
    if (!asked.ok) return null;
    const { path, upload_url } = (await asked.json()) as { path: string; upload_url: string };
    const put = await fetch(upload_url, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: blob,
    });
    return put.ok ? path : null;
  } catch {
    return null;
  }
}
