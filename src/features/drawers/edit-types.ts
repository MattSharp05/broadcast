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

/** The queue editing actions, passed from the Workflow page down to the drawers. */
export interface QueueActions {
  savePost: (input: SavePostInput) => Promise<ActionResult<QueueChange>>;
  postNow: (postId: string) => Promise<ActionResult<QueueChange>>;
  removePost: (postId: string) => Promise<ActionResult<QueueChange>>;
  saveSlots: (input: SaveSlotsInput) => Promise<ActionResult<QueueChange>>;
}

/** What the drawers do after a change saved: show the toast; `closed` when the drawer should close. */
export type OnQueueChanged = (message: string, options?: { close?: boolean }) => void;
