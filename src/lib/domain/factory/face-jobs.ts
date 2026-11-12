/**
 * Paid face clips are never generated twice (pure). The generation proxy asks this before it
 * submits anything:
 * - the same idempotency key as an earlier job → that job (never charge twice);
 * - a slot that already has a clip (done or in flight) → that clip, unless Matthew explicitly
 *   asked to redo that avatar slot. Redoing the script, a scene, the voice, the music or the
 *   caption keeps every paid clip.
 */

export interface ExistingJob {
  id: string;
  slot: string;
  idempotencyKey: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
}

export type SlotDecision =
  | { kind: "existing"; job: ExistingJob; reason: "same_key" | "slot_kept" }
  | { kind: "new"; redo: boolean };

export function decideFaceJob(input: {
  slot: string;
  idempotencyKey: string;
  /** Jobs of the same production (any slot). */
  jobs: readonly ExistingJob[];
  /** Slots with an open "redo this avatar slot" request. */
  redoSlots: readonly string[];
}): SlotDecision {
  const same = input.jobs.find((j) => j.idempotencyKey === input.idempotencyKey);
  if (same) return { kind: "existing", job: same, reason: "same_key" };

  const kept = input.jobs
    .filter((j) => j.slot === input.slot && j.status !== "failed")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (kept && !input.redoSlots.includes(input.slot)) {
    return { kind: "existing", job: kept, reason: "slot_kept" };
  }
  return { kind: "new", redo: Boolean(kept) };
}
