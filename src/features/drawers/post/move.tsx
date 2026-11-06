"use client";

import { createContext, useContext, useId, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Select } from "@/components/Select";
import type { CanvasColumn, UpcomingCard } from "@/lib/domain/canvas";
import type { AccountDetail } from "@/lib/domain/details";
import { whenLabel } from "@/lib/domain/format";
import edit from "../edit.module.css";
import styles from "../drawers.module.css";
import type { MovePlacementInput, OnQueueChanged, QueueActions } from "../edit-types";
import type { DetailClock } from "../types";

/**
 * "Move to…" in a waiting post's drawer (BC-22): the keyboard way to do what dragging a card on
 * the canvas does. Choose an account and a place in its queue (first, after a post, last, or an
 * open slot); the move goes through the same action as a drop, and the toast offers Undo.
 */

/** The accounts a post can move to and what their queues look like on the canvas. */
export interface MoveChoices {
  columns: readonly Pick<CanvasColumn, "id" | "handle" | "upcoming">[];
  /** Whether a post of `sourceId` can move to `targetId` (ready, has slots, same rules). */
  accepts: (targetId: string, sourceId: string) => boolean;
}

const MoveChoicesContext = createContext<MoveChoices | null>(null);
export const MoveChoicesProvider = MoveChoicesContext.Provider;

export function moveChoices(
  columns: readonly CanvasColumn[],
  accepts: MoveChoices["accepts"],
): MoveChoices {
  return { columns, accepts };
}

export function useMoveChoices(): MoveChoices | null {
  return useContext(MoveChoicesContext);
}

interface PositionOption {
  value: string;
  label: string;
  placement: MovePlacementInput;
}

/** The places in one account's queue a post can go, as select options. */
export function positionOptions(
  upcoming: readonly UpcomingCard[],
  postId: string,
  clock: DetailClock,
): PositionOption[] {
  const out: PositionOption[] = [
    { value: "first", label: "First in the queue", placement: { kind: "queue", after: null } },
  ];
  for (const c of upcoming) {
    if (c.id === postId) continue;
    if (c.kind === "scheduled" || c.kind === "paused") {
      const when = c.at ? `, ${whenLabel(c.at, clock.now, clock.timezone)}` : "";
      out.push({
        value: `after:${c.id}`,
        label: `After “${c.title}”${when}`,
        placement: { kind: "queue", after: c.id },
      });
    } else if (c.kind === "open") {
      out.push({
        value: `slot:${c.at.toISOString()}`,
        label: `Open slot, ${whenLabel(c.at, clock.now, clock.timezone)}`,
        placement: { kind: "slot", at: c.at.toISOString() },
      });
    }
  }
  out.push({ value: "last", label: "Last in the queue", placement: { kind: "back" } });
  return out;
}

export interface MoveFormProps {
  card: Exclude<UpcomingCard, { kind: "open" }>;
  account: AccountDetail;
  clock: DetailClock;
  actions: QueueActions;
  onChanged: OnQueueChanged;
  onCancel: () => void;
}

/** The inline "Move to…" form (account + position). */
export function MoveForm({ card, account, clock, actions, onChanged, onCancel }: MoveFormProps) {
  const choices = useMoveChoices();
  const ids = { account: useId(), position: useId() };
  const targets = (choices?.columns ?? []).filter((c) => choices?.accepts(c.id, account.id));
  const [accountId, setAccountId] = useState(
    targets.some((c) => c.id === account.id) ? account.id : (targets[0]?.id ?? ""),
  );
  const column = targets.find((c) => c.id === accountId);
  const options = column ? positionOptions(column.upcoming, card.id, clock) : [];
  const [position, setPosition] = useState("last");
  const chosen = options.find((o) => o.value === position) ?? options[options.length - 1];
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (targets.length === 0) {
    return (
      <div className={edit.confirm} role="group" aria-label="Move to">
        <span>No account can take this post right now.</span>
        <Button variant="ghost" onClick={onCancel}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.move} role="group" aria-label="Move to" data-section="move">
      <div className={styles.moveFields}>
        <label className={edit.field} htmlFor={ids.account}>
          <span className={edit.label}>Account</span>
          <Select
            id={ids.account}
            value={accountId}
            disabled={busy}
            onChange={(e) => {
              setAccountId(e.target.value);
              setPosition("last");
            }}
          >
            {targets.map((c) => (
              <option key={c.id} value={c.id}>
                @{c.handle}
              </option>
            ))}
          </Select>
        </label>
        <label className={edit.field} htmlFor={ids.position}>
          <span className={edit.label}>Position</span>
          <Select
            id={ids.position}
            value={chosen?.value ?? "last"}
            disabled={busy}
            onChange={(e) => {
              setPosition(e.target.value);
            }}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <span className={edit.help}>You can also drag the card on the canvas.</span>
      {error ? (
        <p className={edit.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={busy || !chosen}
          onClick={() => {
            if (!chosen) return;
            setError(null);
            startTransition(async () => {
              try {
                const result = await actions.movePost({
                  postId: card.id,
                  accountId,
                  placement: chosen.placement,
                });
                if (result.ok) {
                  onCancel();
                  onChanged(result.value.message, { undo: result.value.undo });
                } else setError(result.error);
              } catch {
                setError("Couldn't move the post. Check your connection and try again.");
              }
            });
          }}
        >
          Move
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
