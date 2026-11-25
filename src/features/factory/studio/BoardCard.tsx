"use client";

import { ArrowDown, ArrowUp, GripVertical, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteCard, redoCard, updateCard, type FactoryResult } from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import { TextArea } from "@/components/TextArea";
import type { CardView } from "@/lib/db/studio-page";
import { CARD_TEXT_MAX } from "@/lib/domain/factory/board";
import styles from "./studio.module.css";

interface BoardCardProps {
  videoId: string;
  card: CardView;
  index: number;
  count: number;
  editable: boolean;
  pending: boolean;
  run: <T>(
    fn: () => Promise<FactoryResult<T>>,
    success?: string | ((v: T) => string | null),
  ) => void;
  onMove: (to: number) => void;
  dragProps: React.HTMLAttributes<HTMLLIElement> & { draggable?: boolean };
}

/** One storyboard card: its still, what happens or is said, how long, and its status. */
export function BoardCard({
  videoId,
  card,
  index,
  count,
  editable,
  pending,
  run,
  onMove,
  dragProps,
}: BoardCardProps) {
  const [text, setText] = useState(card.text);
  const [seconds, setSeconds] = useState(String(card.seconds));
  const [redo, setRedo] = useState<string | null>(null);
  const n = index + 1;
  const locked = !editable || pending;
  const saveSeconds = () => {
    const s = Number(seconds);
    if (s === card.seconds) return;
    if (!(s > 0)) {
      setSeconds(String(card.seconds));
      return;
    }
    run(() => updateCard(videoId, card.id, { seconds: s }));
  };
  return (
    <li
      className={styles.boardCard}
      data-testid="card"
      data-scene={card.sceneId ?? ""}
      {...dragProps}
    >
      <div className={styles.cardHead}>
        {editable ? <GripVertical aria-hidden="true" className={styles.grip} /> : null}
        <span className={styles.badge}>{n}</span>
        <span className={styles.meta}>{card.sceneId ?? "New card"}</span>
        <span className={styles.grow} />
        <span className={styles.noteStatus} data-status={card.status}>
          {card.status === "approved" ? "Approved" : card.status === "built" ? "Built" : "Planned"}
        </span>
      </div>
      <div className={styles.cardBody}>
        {card.stillUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.cardStill} src={card.stillUrl} alt={`Still for card ${n}`} />
        ) : (
          <span className={`${styles.cardStill} ${styles.noStill}`}>No still</span>
        )}
        <div className={styles.cardFields}>
          <TextArea
            className={styles.textarea}
            value={text}
            aria-label={`Card ${n} text`}
            maxLength={CARD_TEXT_MAX}
            disabled={locked}
            rows={3}
            onChange={(e) => {
              setText(e.target.value);
            }}
            onBlur={() => {
              if (text !== card.text) run(() => updateCard(videoId, card.id, { text }));
            }}
          />
          <label className={styles.secondsField}>
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={seconds}
              aria-label={`Card ${n} seconds`}
              disabled={locked}
              onChange={(e) => {
                setSeconds(e.target.value);
              }}
              onBlur={saveSeconds}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveSeconds();
              }}
            />
            s
          </label>
        </div>
      </div>
      {editable ? (
        <div className={styles.row}>
          <Button
            variant="ghost"
            aria-label={`Move card ${n} up`}
            disabled={pending || index === 0}
            onClick={() => {
              onMove(index - 1);
            }}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            aria-label={`Move card ${n} down`}
            disabled={pending || index === count - 1}
            onClick={() => {
              onMove(index + 1);
            }}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <span className={styles.grow} />
          {card.sceneId ? (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setRedo(redo === null ? "" : null);
              }}
            >
              <RotateCcw aria-hidden="true" />
              Redo this card
            </Button>
          ) : null}
          <Button
            variant="ghost"
            aria-label={`Delete card ${n}`}
            disabled={pending}
            onClick={() => {
              run(() => deleteCard(videoId, card.id), "Card deleted.");
            }}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      {redo !== null ? (
        <div className={styles.noteForm}>
          <TextArea
            className={styles.textarea}
            value={redo}
            aria-label={`What to change on card ${n}`}
            placeholder="Redo this card: what should change?"
            onChange={(e) => {
              setRedo(e.target.value);
            }}
          />
          <div className={styles.row}>
            <Button
              variant="primary"
              disabled={pending || !redo.trim()}
              onClick={() => {
                run(
                  () => redoCard(videoId, card.id, redo),
                  `Redoing scene ${card.sceneId ?? ""}: the visuals step runs again.`,
                );
                setRedo(null);
              }}
            >
              Redo scene {card.sceneId}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRedo(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
