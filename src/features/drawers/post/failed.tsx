"use client";

import { RefreshCw, TriangleExclamationPoint, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { readVideo } from "@/features/content/media";
import { putFile, requestUploadTicket } from "@/features/content/upload";
import type { PostedCard } from "@/lib/domain/canvas";
import { connectionNote, type AccountDetail, type PostDetail } from "@/lib/domain/details";
import { FAILED_MESSAGES, attemptRows } from "@/lib/domain/failed-posts";
import styles from "../drawers.module.css";
import edit from "../edit.module.css";
import type { OnQueueChanged, QueueActions } from "../edit-types";
import type { DetailClock } from "../types";

type Result = { ok: true; value: { message: string } } | { ok: false; error: string };

const SAVE_FAILED = "Couldn't save the change. Check your connection and try again.";

export interface FailedPostProps {
  card: Extract<PostedCard, { kind: "failed" }>;
  account: AccountDetail;
  detail?: PostDetail;
  clock: DetailClock;
  /** Read-only (attempts only) without. */
  actions?: QueueActions;
  onChanged?: OnQueueChanged;
}

type Phase =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "uploading"; progress: number }
  | { kind: "saving" };

/**
 * A failed post's attempts and actions (BC-20, mockup "failed drawer"), under the error note:
 * the publish log as "time: result" rows, then "Replace video" (a new file through BC-14's checks
 * and upload; caption kept, then retried), "Retry now" (retries reset, due now: the scheduler's
 * next tick takes it) and "Remove" with an inline confirm.
 */
export function FailedPost({ card, account, detail, clock, actions, onChanged }: FailedPostProps) {
  const rows = useMemo(
    () => attemptRows(detail?.history ?? [], clock.now, clock.timezone),
    [detail?.history, clock.now, clock.timezone],
  );
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const busy = pending || phase.kind !== "idle";
  const ready = account.status === "ready";
  const kept = detail?.containerKept ?? false;
  const blocked = ready ? null : connectionNote(account);

  function done(result: Result, close = false) {
    if (result.ok) {
      setConfirming(false);
      onChanged?.(result.value.message, { close });
    } else setError([result.error]);
  }

  function run(action: () => Promise<Result>, close = false) {
    setError(null);
    startTransition(async () => {
      try {
        done(await action(), close);
      } catch {
        setError([SAVE_FAILED]);
      }
    });
  }

  async function replace(file: File | undefined) {
    const replaceVideo = actions?.replaceVideo;
    if (!file || !replaceVideo || busy) return;
    setError(null);
    setPhase({ kind: "reading" });
    const controller = new AbortController();
    abort.current = controller;
    let thumbUrl: string | null = null;
    try {
      const video = await readVideo(file);
      thumbUrl = video.thumbnailUrl;
      if (video.issues.length > 0) {
        setError(video.issues.map((i) => i.message));
        return;
      }
      setPhase({ kind: "uploading", progress: 0 });
      const ticket = await requestUploadTicket(file);
      await putFile(
        ticket.video.uploadUrl,
        file,
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
      done(
        await replaceVideo({
          postId: card.id,
          fileName: file.name,
          videoPath: ticket.video.path,
          thumbnailPath,
        }),
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setError([err instanceof Error ? err.message : "The upload failed. Try again."]);
    } finally {
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      if (!controller.signal.aborted) setPhase({ kind: "idle" });
    }
  }

  const replaceLabel =
    phase.kind === "reading"
      ? "Checking the video…"
      : phase.kind === "uploading"
        ? `Uploading… ${Math.round(phase.progress * 100)}%`
        : phase.kind === "saving"
          ? "Saving…"
          : "Replace video";

  return (
    <>
      <section className={styles.section} data-section="attempts">
        <h3>Attempts</h3>
        {rows.length > 0 ? (
          <dl className={styles.dl}>
            {rows.map((r, i) => (
              <div key={i} title={r.message} data-ok={r.ok ? "" : undefined}>
                <dt>{r.time}</dt>
                <dd>{r.result}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={edit.help}>No attempts are logged for this post.</p>
        )}
      </section>

      {kept ? (
        <p className={edit.help} data-testid="container-kept">
          {FAILED_MESSAGES.container_kept}
        </p>
      ) : null}

      {error ? (
        <div className={styles.note} data-tone="bad" role="alert">
          <TriangleExclamationPoint aria-hidden="true" />
          <span>
            {error.map((e) => (
              <span key={e} className={edit.line}>
                {e}
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {!actions ? null : confirming ? (
        <div className={edit.confirm} role="group" aria-label="Remove the failed post">
          <span>Remove this failed post from @{account.handle}? It won&apos;t be posted.</span>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (actions.removeFailed) run(actions.removeFailed.bind(null, card.id), true);
            }}
          >
            Remove
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
            }}
          >
            Keep it
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
          <span title={blocked ?? (kept ? FAILED_MESSAGES.container_kept : undefined)}>
            <Button
              variant="primary"
              disabled={busy || !ready || kept || !actions.replaceVideo}
              onClick={() => fileInput.current?.click()}
            >
              <Upload aria-hidden="true" />
              {replaceLabel}
            </Button>
          </span>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept="video/mp4,video/quicktime,.mp4,.mov,.m4v"
            data-testid="replace-video-file"
            onChange={(e) => {
              void replace(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <span title={blocked ?? undefined}>
            <Button
              disabled={busy || !ready || !actions.retryPost}
              onClick={() => {
                if (actions.retryPost) run(actions.retryPost.bind(null, card.id));
              }}
            >
              <RefreshCw aria-hidden="true" />
              Retry now
            </Button>
          </span>
          <Button
            variant="danger"
            disabled={busy || !actions.removeFailed}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Remove
          </Button>
        </div>
      )}
    </>
  );
}
