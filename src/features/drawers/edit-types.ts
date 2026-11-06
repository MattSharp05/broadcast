import type { ActionResult } from "@/features/content/types";

/** Shapes shared by the drawer editors and the server actions they call (BC-18). */

export interface SavePostInput {
  postId: string;
  caption: string;
  /** `local` is a `datetime-local` value in the workspace timezone. */
  timing: { kind: "queue" } | { kind: "pinned"; local: string };
}

export interface SaveSlotsInput {
  accountId: string;
  slots: string[];
}

export interface QueueChange {
  /** The toast that echoes the action. */
  message: string;
}

/** Where a moved post goes (BC-22); times are ISO strings. See src/lib/domain/move.ts. */
export type MovePlacementInput =
  | { kind: "queue"; after: string | null }
  | { kind: "back" }
  | { kind: "slot"; at: string }
  | { kind: "pinned"; at: string };

export interface MovePostInput {
  postId: string;
  accountId: string;
  placement: MovePlacementInput;
}

export interface MovedChange extends QueueChange {
  /** The move that puts the post back (the toast's Undo). */
  undo: MovePostInput;
}

/** "Replace video" on a failed post (BC-20): the new upload, already in Storage. */
export interface ReplaceVideoInput {
  postId: string;
  fileName: string;
  videoPath: string;
  /** null when the browser couldn't grab a frame. */
  thumbnailPath: string | null;
}

/** The queue editing actions, passed from the Workflow page down to the drawers. */
export interface QueueActions {
  savePost: (input: SavePostInput) => Promise<ActionResult<QueueChange>>;
  postNow: (postId: string) => Promise<ActionResult<QueueChange>>;
  removePost: (postId: string) => Promise<ActionResult<QueueChange>>;
  saveSlots: (input: SaveSlotsInput) => Promise<ActionResult<QueueChange>>;
  /** Drag on the canvas or "Move to…" in the drawer; `undoing` words the toast for an Undo. */
  movePost: (input: MovePostInput, undoing?: boolean) => Promise<ActionResult<MovedChange>>;
  /** A failed post's drawer (BC-20): "Retry now", "Replace video" and "Remove". */
  retryPost?: (postId: string) => Promise<ActionResult<QueueChange>>;
  replaceVideo?: (input: ReplaceVideoInput) => Promise<ActionResult<QueueChange>>;
  removeFailed?: (postId: string) => Promise<ActionResult<QueueChange>>;
}

/**
 * What the drawers do after a change saved: show the toast; `close` when the drawer should close,
 * `undo` to offer an Undo button on the toast.
 */
export type OnQueueChanged = (
  message: string,
  options?: { close?: boolean; undo?: MovePostInput },
) => void;
