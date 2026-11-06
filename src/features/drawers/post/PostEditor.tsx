"use client";

import { ArrowRightLeft, Info, Send, TriangleExclamationPoint } from "lucide-react";
import { useId, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { Thumb } from "@/features/canvas/content/cards";
import type { UpcomingCard } from "@/lib/domain/canvas";
import { MAX_CAPTION_LENGTH, utcToLocalInput } from "@/lib/domain/content";
import {
  DAILY_POST_LIMIT,
  connectionNote,
  type AccountDetail,
  type PostDetail,
} from "@/lib/domain/details";
import styles from "../drawers.module.css";
import edit from "../edit.module.css";
import type { OnQueueChanged, QueueActions } from "../edit-types";
import type { DetailClock } from "../types";
import { EDIT_MESSAGES } from "@/lib/domain/queue-edit";
import { MoveForm, useMoveChoices } from "./move";

const HOUR_MS = 3_600_000;
const QUARTER_MS = 15 * 60_000;

function Note({ tone, children }: { tone?: "warn"; children: ReactNode }) {
  return (
    <div className={styles.note} data-tone={tone}>
      {tone ? <TriangleExclamationPoint aria-hidden="true" /> : <Info aria-hidden="true" />}
      <span>{children}</span>
    </div>
  );
}

/** Where the pinned-time input starts: the post's current time, else an hour from now (rounded). */
function defaultPin(at: Date | null, clock: DetailClock): string {
  const start =
    at && at > clock.now
      ? at
      : new Date(Math.ceil((clock.now.getTime() + HOUR_MS) / QUARTER_MS) * QUARTER_MS);
  return utcToLocalInput(start, clock.timezone);
}

export interface PostEditorProps {
  /** A waiting post (not an open slot; publishing posts stay read-only). */
  card: Exclude<UpcomingCard, { kind: "open" }>;
  account: AccountDetail;
  detail?: PostDetail;
  clock: DetailClock;
  actions: QueueActions;
  onChanged: OnQueueChanged;
}

/**
 * A waiting post's drawer body with editing (BC-18, mockup "scheduled post drawer"): the caption,
 * the timing (queue slot or a pinned time), "Save changes", "Post now" (due now; the scheduler's
 * next tick publishes it) and "Remove from queue" with an inline confirm.
 */
export function PostEditor({ card, account, detail, clock, actions, onChanged }: PostEditorProps) {
  const ids = { caption: useId(), pin: useId(), help: useId() };
  const savedCaption = detail?.caption ?? card.title;
  const savedTiming = detail?.timing ?? (card.kind === "pinned" ? "pinned" : "queue");
  const savedPin =
    savedTiming === "pinned" && card.at ? utcToLocalInput(card.at, clock.timezone) : null;

  const [caption, setCaption] = useState(savedCaption);
  const [timing, setTiming] = useState<"queue" | "pinned">(savedTiming);
  const [pinLocal, setPinLocal] = useState(() => defaultPin(card.at, clock));
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const canMove = useMoveChoices() !== null;
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const over = caption.length > MAX_CAPTION_LENGTH;
  const dirty =
    caption.trim() !== savedCaption ||
    timing !== savedTiming ||
    (timing === "pinned" && pinLocal !== savedPin);
  // The scheduler only publishes queued posts of ready accounts.
  const canPostNow = account.status === "ready" && card.kind !== "paused";

  function run(
    action: () => Promise<{ ok: true; value: { message: string } } | { ok: false; error: string }>,
    close = false,
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          setConfirming(false);
          onChanged(result.value.message, { close });
        } else setError(result.error);
      } catch {
        setError("Couldn't save the change. Check your connection and try again.");
      }
    });
  }

  return (
    <>
      {card.kind === "paused" ? <Note tone="warn">{connectionNote(account)}</Note> : null}
      <div className={styles.split}>
        <Thumb
          url={card.thumbnailUrl}
          durationS={card.durationS}
          colour={account.avatar}
          className={styles.thumb}
        />
        <div className={`${edit.field} ${edit.grow}`} data-section="caption">
          <label htmlFor={ids.caption}>Caption</label>
          <textarea
            id={ids.caption}
            className={edit.input}
            rows={7}
            value={caption}
            disabled={busy}
            onChange={(e) => {
              setCaption(e.target.value);
            }}
          />
          <span className={edit.count} data-over={over ? "" : undefined}>
            {caption.length} / {MAX_CAPTION_LENGTH}
          </span>
        </div>
      </div>

      <fieldset className={edit.field} data-section="timing" disabled={busy}>
        <legend>Timing</legend>
        <div className={edit.radio}>
          <label>
            <input
              type="radio"
              name={`timing-${card.id}`}
              checked={timing === "queue"}
              onChange={() => {
                setTiming("queue");
              }}
            />
            Queue slot
          </label>
          <label>
            <input
              type="radio"
              name={`timing-${card.id}`}
              checked={timing === "pinned"}
              onChange={() => {
                setTiming("pinned");
              }}
            />
            Pinned time
          </label>
        </div>
        {timing === "pinned" ? (
          <input
            id={ids.pin}
            className={edit.input}
            type="datetime-local"
            aria-label="Pinned date and time"
            aria-describedby={ids.help}
            value={pinLocal}
            min={utcToLocalInput(clock.now, clock.timezone)}
            onChange={(e) => {
              setPinLocal(e.target.value);
            }}
          />
        ) : null}
        <span className={edit.help} id={ids.help}>
          {timing === "pinned"
            ? "Stays at this time even if the queue changes."
            : "Moves up automatically if an earlier video is removed."}
        </span>
      </fieldset>

      <Note>
        @{account.handle} has used {account.postsUsed24h} of its {DAILY_POST_LIMIT} posts in the
        last 24 hours.
      </Note>

      {error ? (
        <p className={edit.error} role="alert">
          {error}
        </p>
      ) : null}

      {moving ? (
        <MoveForm
          card={card}
          account={account}
          clock={clock}
          actions={actions}
          onChanged={onChanged}
          onCancel={() => {
            setMoving(false);
          }}
        />
      ) : confirming ? (
        <div className={edit.confirm} role="group" aria-label="Remove from queue">
          <span>Remove this video from @{account.handle}&apos;s queue? Later posts move up.</span>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              run(() => actions.removePost(card.id), true);
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
          <Button
            variant="primary"
            disabled={busy || !dirty || over}
            onClick={() => {
              run(() =>
                actions.savePost({
                  postId: card.id,
                  caption,
                  timing:
                    timing === "pinned" ? { kind: "pinned", local: pinLocal } : { kind: "queue" },
                }),
              );
            }}
          >
            Save changes
          </Button>
          <span
            title={
              canPostNow
                ? undefined
                : account.status === "ready"
                  ? EDIT_MESSAGES.post_paused
                  : connectionNote(account)
            }
          >
            <Button
              disabled={busy || !canPostNow}
              onClick={() => {
                run(() => actions.postNow(card.id));
              }}
            >
              <Send aria-hidden="true" />
              Post now
            </Button>
          </span>
          {canMove ? (
            <Button
              disabled={busy}
              onClick={() => {
                setMoving(true);
              }}
            >
              <ArrowRightLeft aria-hidden="true" />
              Move to…
            </Button>
          ) : null}
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Remove from queue
          </Button>
        </div>
      )}
    </>
  );
}
