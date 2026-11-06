import { holdDue, nextQueuePosition, type ExistingPost } from "./content";
import { whenLabel } from "./format";
import { planQueue, type PostStatus, type PostTiming } from "./queue";
import { isEditable } from "./queue-edit";

/**
 * Moving a waiting post to another place in a queue, or to another account (BC-22): dragging a
 * card on the canvas, or "Move to…" in the post drawer. Pure: src/lib/db/queue-edit.ts reads the
 * rows, writes the move through the same guarded UPDATE as every queue edit, then re-times both
 * accounts.
 */

/** Where the post goes in the target account. */
export type MovePlacement =
  /** Into the backlog right after this queue post (null: the front of the queue). */
  | { kind: "queue"; after: string | null }
  /** The back of the backlog. */
  | { kind: "back" }
  /**
   * An open slot on the canvas: the post takes that slot's time. It joins the back of the queue
   * when that's where the back of the queue posts anyway, otherwise it's pinned to the slot.
   */
  | { kind: "slot"; at: Date }
  /** A fixed time (undoing a move of a pinned post). */
  | { kind: "pinned"; at: Date };

export interface MoveTarget {
  accountId: string;
  placement: MovePlacement;
}

export type MoveProblem =
  | "not_editable"
  | "unknown_account"
  | "target_not_ready"
  | "target_no_slots"
  | "other_platform"
  | "slot_past"
  | "unknown_position";

export const MOVE_MESSAGES: Record<MoveProblem, string> = {
  not_editable:
    "This post is being published (or is no longer in the queue), so it can't be moved. Reload to see where it is.",
  unknown_account: "That account no longer exists. Reload the page and try again.",
  target_not_ready:
    "That account needs attention, so it can't take new posts. Reconnect it on the Accounts tab first.",
  target_no_slots: "That account has no posting slots yet. Add one in its drawer first.",
  other_platform: "That account posts to another platform, so this video can't move there.",
  slot_past: "That time has passed. Choose a later slot.",
  unknown_position: "The queue changed meanwhile. Reload the page and try again.",
};

/**
 * Which format rules a platform's videos must pass. The fake provider mimics Instagram, so a
 * video that passed for one can go to the other.
 */
export function mediaRules(platform: string): string {
  return platform === "fake" || platform === "instagram" ? "instagram-reels" : platform;
}

export interface MoveCheckInput {
  status: PostStatus;
  sourcePlatform: string;
  target: { status: string; slots: readonly string[]; platform: string } | null;
  placement: MovePlacement;
  now: Date;
}

/** Why the move can't happen, or null when it can. */
export function moveProblem(input: MoveCheckInput): MoveProblem | null {
  if (!isEditable(input.status)) return "not_editable";
  const { target, placement } = input;
  if (!target) return "unknown_account";
  if (target.status !== "ready") return "target_not_ready";
  if (target.slots.length === 0) return "target_no_slots";
  if (mediaRules(target.platform) !== mediaRules(input.sourcePlatform)) return "other_platform";
  if (
    (placement.kind === "slot" || placement.kind === "pinned") &&
    (Number.isNaN(placement.at.getTime()) || placement.at <= input.now)
  ) {
    return "slot_past";
  }
  return null;
}

/** A waiting post of the target account, as the move reads it. */
export interface QueueRow {
  id: string;
  timing: PostTiming;
  queuePosition: number | null;
  scheduledAt: Date | null;
  status: PostStatus;
  /** Held by a tick (lease not expired): keeps its time. */
  claimed?: boolean;
}

/** The account's backlog (queue posts that wait), in the order they go out. */
export function backlogOrder(rows: readonly QueueRow[]): QueueRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) => row.timing === "queue" && (row.status === "queued" || row.status === "paused"),
    )
    .sort(
      (a, b) =>
        (a.row.queuePosition ?? Infinity) - (b.row.queuePosition ?? Infinity) || a.index - b.index,
    )
    .map(({ row }) => row);
}

/** `reorder`'s "the back of the backlog". */
export const BACK: unique symbol = Symbol("back");

/**
 * The backlog's new order with `movedId` placed after `after` (null: first; BACK: last).
 * Null when `after` isn't in the backlog any more.
 */
export function reorder(
  backlog: readonly { id: string }[],
  movedId: string,
  after: string | null | typeof BACK,
): string[] | null {
  const ids = backlog.map((p) => p.id).filter((id) => id !== movedId);
  if (after === BACK) return [...ids, movedId];
  if (after === null) return [movedId, ...ids];
  const i = ids.indexOf(after);
  if (i < 0) return null;
  return [...ids.slice(0, i + 1), movedId, ...ids.slice(i + 1)];
}

/**
 * `queue_position`s for a backlog order: the old positions stay where they already fit, so a move
 * usually rewrites only the moved post; otherwise the backlog is numbered 0, 1, 2, … again.
 * `taken` holds the positions other posts of the account keep outside the backlog (published,
 * removed, failed, pinned, being published): `queue_position` is unique per account
 * (0007_api_keys.sql), so the backlog never takes one of them.
 */
export function positionChanges(
  order: readonly string[],
  current: ReadonlyMap<string, number | null>,
  movedId: string,
  taken: ReadonlySet<number> = new Set(),
): { id: string; queuePosition: number }[] {
  const free = (n: number) => !taken.has(n);
  const i = order.indexOf(movedId);
  // undefined: no neighbour on that side; null: a neighbour without a position (renumber).
  const lo = i > 0 ? (current.get(order[i - 1] ?? "") ?? null) : undefined;
  const hi = i >= 0 && i < order.length - 1 ? (current.get(order[i + 1] ?? "") ?? null) : undefined;
  if (lo !== null && hi !== null) {
    let pos: number | null = null;
    if (lo === undefined && hi === undefined) {
      pos = 0;
      while (!free(pos)) pos++;
    } else if (lo === undefined && hi !== undefined) {
      pos = hi - 1;
      while (!free(pos)) pos--;
    } else if (lo !== undefined && hi === undefined) {
      pos = lo + 1;
      while (!free(pos)) pos++;
    } else if (lo !== undefined && hi !== undefined) {
      for (let n = lo + 1; n < hi && pos === null; n++) if (free(n)) pos = n;
    }
    if (pos !== null) return [{ id: movedId, queuePosition: pos }];
  }
  const out: { id: string; queuePosition: number }[] = [];
  let next = 0;
  for (const id of order) {
    while (!free(next)) next++;
    if (id === movedId || current.get(id) !== next) out.push({ id, queuePosition: next });
    next++;
  }
  return out;
}

/**
 * Where an open-slot drop lands: the back of the queue when the planner would give the back of
 * the queue exactly that slot, else a pin to the slot's time.
 */
export function slotPlacement(input: {
  rows: readonly QueueRow[];
  movedId: string;
  at: Date;
  slots: readonly string[];
  timezone: string;
  now: Date;
}): "back" | "pinned" {
  const others: ExistingPost[] = input.rows.filter((r) => r.id !== input.movedId);
  const posts = holdDue(
    [
      ...input.rows
        .filter((r) => r.id !== input.movedId)
        .map((r) => ({ ...r, claimed: r.claimed ?? false })),
      {
        id: input.movedId,
        timing: "queue" as const,
        queuePosition: nextQueuePosition(others),
        scheduledAt: null,
        status: "queued" as const,
      },
    ],
    input.now,
  );
  const planned = planQueue({
    slots: input.slots,
    timezone: input.timezone,
    now: input.now,
    posts,
  });
  const at = planned.find((p) => p.id === input.movedId)?.scheduledAt;
  const minute = (d: Date) => Math.floor(d.getTime() / 60_000);
  return at && minute(at) === minute(input.at) ? "back" : "pinned";
}

/** The placement that puts a post back where it is now (the move's Undo). */
export function undoPlacement(
  post: { id: string; timing: PostTiming; scheduledAt: Date | null },
  sourceBacklog: readonly { id: string }[],
): MovePlacement {
  if (post.timing === "pinned" && post.scheduledAt) return { kind: "pinned", at: post.scheduledAt };
  const i = sourceBacklog.findIndex((p) => p.id === post.id);
  if (i < 0) return { kind: "back" };
  return { kind: "queue", after: sourceBacklog[i - 1]?.id ?? null };
}

/** "Moved to @trip.app, Tomorrow, 12:00." */
export function movedMessage(handle: string, at: Date | null, now: Date, timezone: string): string {
  if (!at) return `Moved to @${handle}. It waits in the backlog until a slot opens.`;
  return `Moved to @${handle}, ${whenLabel(at, now, timezone)}.`;
}

export const MOVE_UNDONE_MESSAGE = "Move undone. The queue is back as it was.";
