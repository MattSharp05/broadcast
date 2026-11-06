"use client";

import { Plus, X } from "lucide-react";
import { useId, useOptimistic, useState, useTransition } from "react";
import { SLOTS_MAX, addSlot } from "@/lib/domain/add-account";
import type { AccountDetail } from "@/lib/domain/details";
import styles from "../drawers.module.css";
import edit from "../edit.module.css";
import type { OnQueueChanged, QueueActions } from "../edit-types";

export interface SlotsEditorProps {
  account: AccountDetail;
  actions: QueueActions;
  onChanged: OnQueueChanged;
}

/**
 * The account drawer's daily posting slots, editable (BC-18): add one with the time input, remove
 * one with ×. Each change saves at once and re-times the account's queue; the chips update before
 * the server answers.
 */
export function SlotsEditor({ account, actions, onChanged }: SlotsEditorProps) {
  const labelId = useId();
  const [slots, setOptimistic] = useOptimistic(account.slots);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function save(next: string[]) {
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      try {
        const result = await actions.saveSlots({ accountId: account.id, slots: next });
        if (result.ok) onChanged(result.value.message);
        else setError(result.error);
      } catch {
        setError("Couldn't save the slots. Check your connection and try again.");
      }
    });
  }

  function addTyped() {
    if (!input) return;
    const next = addSlot(slots, input);
    if (!next) {
      setError(
        slots.length >= SLOTS_MAX
          ? `An account can have at most ${SLOTS_MAX} slots.`
          : `@${account.handle} already posts at ${input}.`,
      );
      return;
    }
    setInput("");
    save(next);
  }

  return (
    <section className={styles.section} data-section="slots" aria-busy={busy}>
      <h3 id={labelId}>Daily posting slots</h3>
      <div className={edit.slots} role="group" aria-labelledby={labelId}>
        {slots.map((s) => (
          <span key={s} className={edit.slot} data-slot={s}>
            {s}
            <button
              type="button"
              aria-label={`Remove slot ${s}`}
              onClick={() => {
                save(slots.filter((x) => x !== s));
              }}
            >
              <X aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          className={edit.timeInput}
          type="time"
          aria-label="New slot time"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTyped();
            }
          }}
        />
        <button
          type="button"
          className={edit.linkBtn}
          disabled={slots.length >= SLOTS_MAX || !input}
          onClick={addTyped}
        >
          <Plus aria-hidden="true" />
          Add slot
        </button>
      </div>
      {error ? (
        <p className={edit.error} role="alert">
          {error}
        </p>
      ) : (
        <p className={edit.help}>
          {slots.length === 0
            ? "No slots, so queued videos wait without a time. Add one to schedule them."
            : "The queue posts at these times every day, in the workspace's time zone."}
        </p>
      )}
    </section>
  );
}
