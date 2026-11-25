"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { addCard, approveBoard, moveCard } from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import { boardSeconds } from "@/lib/domain/factory/board";
import { BoardCard } from "./BoardCard";
import type { StudioTabProps } from "./tabs";
import styles from "./studio.module.css";

/** About how long a Reel from the factory runs; Reels stop at 90 s. */
const TARGET_S = 60;
const MAX_S = 90;

/**
 * The Board tab (BC-40): the film as cards (what happens or is said, seconds, a still), read and
 * edited before anything is built, then approved with the visuals step.
 */
export function BoardTab({ video, studio, run, pending }: StudioTabProps) {
  const { board } = studio;
  const editable = board.visuals === "waiting";
  const [dragging, setDragging] = useState<number | null>(null);
  const total = boardSeconds(board.cards);

  if (!board.cards.length) {
    return (
      <div className={styles.empty} data-testid="no-board">
        <h2>No board yet</h2>
        <p className={styles.help}>
          The board appears when the visuals step has run: one card per scene, with its still, what
          happens and how long.
        </p>
      </div>
    );
  }
  const move = (cardId: string, to: number) => {
    run(() => moveCard(video.id, cardId, to));
  };

  return (
    <div className={styles.boardPage}>
      <div className={styles.boardHead}>
        <p className={styles.help} data-testid="board-total">
          {board.cards.length} cards, {total} s in all (aim for about {TARGET_S} s; Reels stop at{" "}
          {MAX_S} s).
          {total > MAX_S ? <span className={styles.over}> Too long for a Reel.</span> : null}
        </p>
        <span className={styles.grow} />
        {board.approvedWhen ? (
          <span className={styles.meta} data-testid="board-approved">
            Approved {board.approvedWhen}
          </span>
        ) : null}
        <Button
          variant="primary"
          disabled={!editable || pending}
          onClick={() => {
            run(() => approveBoard(video.id), "Board approved. The next step has started.");
          }}
        >
          Approve board
        </Button>
      </div>
      {!editable ? (
        <p className={styles.help}>
          {board.visuals === "approved"
            ? "This board is approved: the render builds from it."
            : "The board can be edited while the visuals step waits for you."}
        </p>
      ) : null}
      <ol className={styles.board} data-testid="board">
        {board.cards.map((card, index) => (
          <BoardCard
            key={card.id}
            videoId={video.id}
            card={card}
            index={index}
            count={board.cards.length}
            editable={editable}
            pending={pending}
            run={run}
            onMove={(to) => {
              move(card.id, to);
            }}
            dragProps={
              editable
                ? {
                    draggable: true,
                    onDragStart: (e) => {
                      setDragging(index);
                      e.dataTransfer.effectAllowed = "move";
                    },
                    onDragOver: (e) => {
                      e.preventDefault();
                    },
                    onDrop: (e) => {
                      e.preventDefault();
                      if (dragging !== null && dragging !== index) {
                        const moved = board.cards[dragging];
                        if (moved) move(moved.id, index);
                      }
                      setDragging(null);
                    },
                    onDragEnd: () => {
                      setDragging(null);
                    },
                  }
                : {}
            }
          />
        ))}
      </ol>
      {editable ? (
        <div className={styles.row}>
          <Button
            disabled={pending}
            onClick={() => {
              run(() => addCard(video.id, { text: "", seconds: 5 }), "Card added at the end.");
            }}
          >
            <Plus aria-hidden="true" />
            Add a card
          </Button>
        </div>
      ) : null}
    </div>
  );
}
