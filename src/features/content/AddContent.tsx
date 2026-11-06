"use client";

import { TriangleExclamationPoint, Upload } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Drawer } from "@/components/Drawer";
import {
  MAX_CAPTION_LENGTH,
  firstTime,
  localInputToUtc,
  utcToLocalInput,
  type ContentAccount,
} from "@/lib/domain/content";
import { duration as durationLabel, whenLabel } from "@/lib/domain/format";
import { sizeLabel } from "@/lib/media/checks";
import styles from "./content.module.css";
import { readVideo, type ReadVideo } from "./media";
import type { ActionResult, AddContentInput, AddedContent, UploadTicket } from "./types";
import { putFile } from "./upload";

export interface AddContentPreset {
  accountIds: string[];
  /** Pin to this time (an open slot that isn't the account's next one). */
  pinAt?: Date;
}

export interface AddContentProps {
  open: boolean;
  onClose: () => void;
  accounts: readonly ContentAccount[];
  preset?: AddContentPreset | null;
  /** The workspace clock. */
  now: Date;
  timezone: string;
  addContent: (input: AddContentInput) => Promise<ActionResult<AddedContent>>;
  onAdded: (result: AddedContent) => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "uploading"; progress: number }
  | { kind: "saving" };

const HOUR_MS = 3_600_000;

/** The next whole hour, at least an hour away: a sensible default for "Pin to a time". */
function defaultPin(now: Date): Date {
  return new Date(Math.ceil((now.getTime() + HOUR_MS) / HOUR_MS) * HOUR_MS);
}

function slotLabel(account: ContentAccount, now: Date, timezone: string): string {
  if (account.paused) return "Paused";
  if (!account.nextOpenSlot) return "No slots yet";
  return `Next open slot ${whenLabel(new Date(account.nextOpenSlot), now, timezone)}`;
}

async function requestTicket(file: File): Promise<UploadTicket> {
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, bytes: file.size }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<UploadTicket> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Couldn't start the upload. Try again.");
  return body as UploadTicket;
}

/**
 * Add content (BC-14, mockup "add content"): choose a 9:16 video, write the caption, pick the
 * accounts and the timing. The file is checked in the browser, uploaded straight to Storage with a
 * progress bar (ADR 0005), checked again on the server and queued on every chosen account.
 */
export function AddContent(props: AddContentProps) {
  // Fresh state every time it opens.
  const [opened, setOpened] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpened((n) => n + 1);
  }
  if (!props.open) {
    return (
      <Drawer open={false} onClose={props.onClose} title="">
        {null}
      </Drawer>
    );
  }
  return <AddContentForm key={opened} {...props} />;
}

function AddContentForm({
  onClose,
  accounts,
  preset,
  now,
  timezone,
  addContent,
  onAdded,
}: AddContentProps) {
  const ids = {
    file: useId(),
    caption: useId(),
    pin: useId(),
    hint: useId(),
  };
  const [video, setVideo] = useState<ReadVideo | null>(null);
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        preset?.accountIds.length
          ? preset.accountIds
          : accounts.length === 1
            ? accounts.map((a) => a.id)
            : [],
      ),
  );
  const [mode, setMode] = useState<"queue" | "pinned">(preset?.pinAt ? "pinned" : "queue");
  const [pinLocal, setPinLocal] = useState(() =>
    utcToLocalInput(preset?.pinAt ?? defaultPin(now), timezone),
  );
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const thumbUrl = video?.thumbnailUrl ?? null;

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(
    () => () => {
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    },
    [thumbUrl],
  );

  const busy = phase.kind !== "idle";
  const chosen = accounts.filter((a) => selected.has(a.id));
  const pinAt = mode === "pinned" ? localInputToUtc(pinLocal, timezone) : null;
  const pinProblem =
    mode !== "pinned"
      ? null
      : !pinAt
        ? "Choose a date and time."
        : pinAt <= now
          ? "That time has passed. Choose a later one."
          : null;

  const hint = useMemo(() => {
    if (chosen.length === 0) return "Choose at least one account.";
    const pausedNote = chosen.some((a) => a.paused)
      ? " Paused accounts post once they are reconnected."
      : "";
    if (mode === "pinned") {
      if (!pinAt || pinProblem) return pinProblem ?? "";
      const only = chosen.length === 1 ? chosen[0] : undefined;
      const where = only ? `@${only.handle}` : "every selected account";
      return `Posts ${whenLabel(pinAt, now, timezone)} on ${where}.${pausedNote}`;
    }
    const first = firstTime(
      chosen
        .filter((a) => !a.paused)
        .map((a) => (a.nextOpenSlot ? new Date(a.nextOpenSlot) : null)),
    );
    if (first) return `The first post goes out ${whenLabel(first, now, timezone)}.${pausedNote}`;
    if (chosen.every((a) => a.paused))
      return "Paused, so it waits until the account is reconnected.";
    return `No open slots, so it waits in the backlog.${pausedNote}`;
  }, [chosen, mode, pinAt, pinProblem, now, timezone]);

  const ready =
    video !== null &&
    video.issues.length === 0 &&
    chosen.length > 0 &&
    pinProblem === null &&
    caption.length <= MAX_CAPTION_LENGTH &&
    !busy;

  async function choose(file: File | undefined) {
    if (!file || busy) return;
    setError(null);
    setVideo(null);
    setPhase({ kind: "reading" });
    try {
      setVideo(await readVideo(file));
    } finally {
      setPhase({ kind: "idle" });
    }
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    void choose(e.dataTransfer.files[0]);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!ready) return;
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      setPhase({ kind: "uploading", progress: 0 });
      const ticket = await requestTicket(video.file);
      await putFile(
        ticket.video.uploadUrl,
        video.file,
        ticket.contentType,
        (p) => {
          setPhase({ kind: "uploading", progress: p });
        },
        controller.signal,
      );
      let thumbnailPath: string | null = null;
      if (video.thumbnail) {
        try {
          await putFile(
            ticket.thumbnail.uploadUrl,
            video.thumbnail,
            "image/jpeg",
            undefined,
            controller.signal,
          );
          thumbnailPath = ticket.thumbnail.path;
        } catch (err) {
          if (controller.signal.aborted) throw err;
          // The card keeps its placeholder; the video itself is what matters.
        }
      }
      setPhase({ kind: "saving" });
      const result = await addContent({
        fileName: video.file.name,
        videoPath: ticket.video.path,
        thumbnailPath,
        caption,
        accountIds: chosen.map((a) => a.id),
        timing: mode === "pinned" ? { kind: "pinned", local: pinLocal } : { kind: "queue" },
      });
      if (!result.ok) {
        setError(result.error);
        setPhase({ kind: "idle" });
        return;
      }
      onAdded(result.value);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "The upload failed. Try again.");
      setPhase({ kind: "idle" });
    }
  }

  const issues = video?.issues ?? [];
  const info = video?.info;

  return (
    <Drawer
      open
      onClose={onClose}
      title="Add content"
      subtitle="The video joins the back of each selected account's queue."
      data-testid="add-content"
      footer={
        <>
          <span className={styles.count}>
            {chosen.length} account{chosen.length === 1 ? "" : "s"} selected
          </span>
          <div className={styles.grow} />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} onClick={() => void submit()}>
            {mode === "pinned" ? "Pin post" : "Add to queue"}
          </Button>
        </>
      }
    >
      <div className={styles.form} aria-busy={busy}>
        <label
          className={styles.drop}
          data-over={dragging ? "" : undefined}
          data-bad={issues.length > 0 ? "" : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => {
            setDragging(false);
          }}
          onDrop={onDrop}
          htmlFor={ids.file}
        >
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL
            <img className={styles.preview} src={thumbUrl} alt="" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          <span className={styles.dropText}>
            <b>
              {phase.kind === "reading"
                ? "Reading the video…"
                : video
                  ? video.file.name
                  : "Drop a vertical video or choose a file"}
            </b>
            <span className={styles.help}>
              {info
                ? `${info.width} × ${info.height}, ${durationLabel(Math.round(info.durationS))}, ${sizeLabel(video.file.size)}`
                : "MP4 or MOV in 9:16, 3 to 90 seconds, up to 50 MB"}
            </span>
          </span>
          <input
            id={ids.file}
            className={styles.fileInput}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov,.m4v"
            disabled={busy}
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
            data-testid="add-content-file"
          />
        </label>
        {issues.length > 0 ? (
          <div className={styles.note} data-tone="bad" role="alert" data-testid="media-issues">
            <TriangleExclamationPoint aria-hidden="true" />
            <span>
              {issues.map((i) => (
                <span key={i.code} className={styles.issue}>
                  {i.message}
                </span>
              ))}
            </span>
          </div>
        ) : null}

        <div className={styles.field}>
          <label htmlFor={ids.caption}>Caption</label>
          <textarea
            id={ids.caption}
            className={styles.input}
            rows={3}
            value={caption}
            maxLength={MAX_CAPTION_LENGTH}
            placeholder="What the video is about. The first line becomes the card title."
            onChange={(e) => {
              setCaption(e.target.value);
            }}
            disabled={busy}
          />
        </div>

        <fieldset className={styles.field} disabled={busy}>
          <legend>Post to</legend>
          {accounts.length === 0 ? (
            <p className={styles.help}>No accounts yet. Add one on the Accounts tab.</p>
          ) : (
            <div className={styles.picks}>
              {accounts.map((a) => (
                <label key={a.id} className={styles.pick} data-account={a.handle}>
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => {
                      toggle(a.id);
                    }}
                  />
                  <Avatar handle={a.handle} platform={a.platform} colour={a.avatar} size={30} />
                  <span className={styles.handle}>@{a.handle}</span>
                  <span className={styles.slot} data-paused={a.paused ? "" : undefined}>
                    {slotLabel(a, now, timezone)}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className={styles.field} disabled={busy}>
          <legend>Timing</legend>
          <div className={styles.radio}>
            <label>
              <input
                type="radio"
                name="timing"
                value="queue"
                checked={mode === "queue"}
                onChange={() => {
                  setMode("queue");
                }}
              />
              Next open slot
            </label>
            <label>
              <input
                type="radio"
                name="timing"
                value="pinned"
                checked={mode === "pinned"}
                onChange={() => {
                  setMode("pinned");
                }}
              />
              Pin to a time
            </label>
          </div>
          {mode === "pinned" ? (
            <input
              id={ids.pin}
              className={styles.input}
              type="datetime-local"
              aria-label="Pinned time"
              aria-describedby={ids.hint}
              value={pinLocal}
              min={utcToLocalInput(now, timezone)}
              onChange={(e) => {
                setPinLocal(e.target.value);
              }}
            />
          ) : null}
          <span
            id={ids.hint}
            className={styles.help}
            data-tone={pinProblem ? "bad" : undefined}
            data-testid="timing-hint"
          >
            {hint}
          </span>
        </fieldset>

        {phase.kind === "uploading" || phase.kind === "saving" ? (
          <div className={styles.progress} data-testid="upload-progress">
            <span>
              {phase.kind === "uploading"
                ? `Uploading ${Math.round(phase.progress * 100)}%`
                : "Adding to queues…"}
            </span>
            <div
              className={styles.bar}
              role="progressbar"
              aria-label="Upload"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={phase.kind === "uploading" ? Math.round(phase.progress * 100) : 100}
            >
              <span
                style={{
                  width: `${phase.kind === "uploading" ? Math.round(phase.progress * 100) : 100}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <div className={styles.note} data-tone="bad" role="alert" data-testid="add-content-error">
            <TriangleExclamationPoint aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
