"use server";

import { revalidatePath } from "next/cache";
import { nowFor } from "@/lib/clock";
import type { ActionResult, AddContentInput, AddedContent } from "@/features/content/types";
import { NotFoundError, saveAccountSlots } from "@/lib/db/accounts";
import { ContentError, queueContent } from "@/lib/db/posts";
import { QueueEditError, editPost, postNow, removePost } from "@/lib/db/queue-edit";
import { createServerSupabase } from "@/lib/db/server";
import {
  StoredVideoError,
  isUploadOf,
  probeStoredVideo,
  removeUnusedUpload,
} from "@/lib/db/videos";
import { currentWorkspace } from "@/lib/db/workspace";
import { addedMessage, firstTime, localInputToUtc, type ContentTiming } from "@/lib/domain/content";
import { SLOTS_MAX } from "@/lib/domain/add-account";
import {
  EDIT_MESSAGES,
  POST_NOW_MESSAGE,
  removedMessage,
  savedMessage,
  slotsMessage,
} from "@/lib/domain/queue-edit";
import type { QueueChange, SavePostInput, SaveSlotsInput } from "@/features/drawers/edit-types";
import { checkReel, videoContentType } from "@/lib/media/checks";
import { Mp4Error } from "@/lib/media/mp4";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FAILED = "Couldn't add the video. Check your connection and try again.";

function invalid(error: string): ActionResult<never> {
  return { ok: false, error };
}

/**
 * Add content, last step (ADR 0005): the video is in Storage; check it again on the server (read
 * from Storage, not the browser's word), then queue one post per chosen account and re-time the
 * queues. Acts as the signed-in user (RLS) on the workspace the dashboard shows.
 */
export async function addContent(input: AddContentInput): Promise<ActionResult<AddedContent>> {
  // Server actions take whatever the browser sends: check the shape before trusting the type.
  const raw = input as unknown as Record<string, unknown> | null;
  const rawTiming = raw?.timing as Record<string, unknown> | null | undefined;
  if (
    !raw ||
    typeof raw.videoPath !== "string" ||
    typeof raw.caption !== "string" ||
    typeof raw.fileName !== "string" ||
    !Array.isArray(raw.accountIds) ||
    raw.accountIds.some((id) => typeof id !== "string" || !UUID.test(id)) ||
    (raw.thumbnailPath !== null && typeof raw.thumbnailPath !== "string") ||
    !rawTiming ||
    (rawTiming.kind !== "queue" &&
      (rawTiming.kind !== "pinned" || typeof rawTiming.local !== "string"))
  ) {
    return invalid("That video can't be added. Reload the page and try again.");
  }

  try {
    const db = await createServerSupabase();
    const workspace = await currentWorkspace();
    const now = nowFor(workspace);
    const timezone = workspace.timezone ?? "UTC";
    if (!isUploadOf(workspace.id, input.videoPath, input.thumbnailPath)) {
      return invalid("That upload belongs to the other workspace. Upload the video again.");
    }
    const uploaded = [input.videoPath, input.thumbnailPath].filter((p): p is string => !!p);

    const result = await queueUpload(db, input, { workspaceId: workspace.id, now, timezone });
    // Anything but success: the upload won't be used, so it doesn't stay in the bucket.
    if (!result.ok) await removeUnusedUpload(db, workspace.id, uploaded);
    else {
      revalidatePath("/workflow");
      revalidatePath("/accounts");
    }
    return result;
  } catch (err) {
    console.error(err);
    return invalid(FAILED);
  }
}

/** Checks the stored video and queues it; any refusal comes back as `{ ok: false }`. */
async function queueUpload(
  db: Awaited<ReturnType<typeof createServerSupabase>>,
  input: AddContentInput,
  ctx: { workspaceId: string; now: Date; timezone: string },
): Promise<ActionResult<AddedContent>> {
  const { now, timezone } = ctx;
  try {
    let timing: ContentTiming = { kind: "queue" };
    if (input.timing.kind === "pinned") {
      const at = localInputToUtc(input.timing.local, timezone);
      if (!at) return invalid("Choose a date and time to pin the post to.");
      timing = { kind: "pinned", at };
    }

    let stored;
    try {
      stored = await probeStoredVideo(db, input.videoPath);
    } catch (err) {
      if (err instanceof StoredVideoError) return invalid(err.message);
      if (err instanceof Mp4Error) {
        return invalid(`${err.message} Reels must be an MP4 or MOV video.`);
      }
      throw err;
    }
    const issues = checkReel(
      {
        bytes: stored.bytes,
        fileName: input.fileName,
        mimeType: videoContentType({ bytes: stored.bytes, fileName: input.videoPath }),
      },
      stored.info,
    );
    if (issues.length > 0) {
      return invalid(issues.map((i) => i.message).join(" "));
    }

    const queued = await queueContent(db, {
      workspaceId: ctx.workspaceId,
      timezone,
      now,
      media: {
        storagePath: input.videoPath,
        thumbnailPath: input.thumbnailPath,
        durationS: Math.round(stored.info.durationS * 1000) / 1000,
        width: stored.info.width,
        height: stored.info.height,
        bytes: stored.bytes,
      },
      caption: input.caption.trim(),
      accountIds: input.accountIds,
      timing,
    });
    return {
      ok: true,
      value: {
        message: addedMessage(
          queued.posts.length,
          firstTime(queued.posts.map((p) => p.scheduledAt)),
          now,
          timezone,
        ),
        postIds: queued.posts.map((p) => p.id),
      },
    };
  } catch (err) {
    if (err instanceof ContentError) return invalid(err.message);
    console.error(err);
    return invalid(FAILED);
  }
}

// ── Editing the queue (BC-18) ──────────────────────────────────────────────────────────────────

const EDIT_FAILED = "Couldn't save the change. Check your connection and try again.";

/** The signed-in user's client and the workspace the dashboard shows, with its clock. */
async function queueContext() {
  const db = await createServerSupabase();
  const workspace = await currentWorkspace();
  return {
    db,
    ctx: {
      workspaceId: workspace.id,
      now: nowFor(workspace),
      timezone: workspace.timezone ?? "UTC",
    },
  };
}

function refreshed<T>(value: T): ActionResult<T> {
  revalidatePath("/workflow");
  revalidatePath("/accounts");
  return { ok: true, value };
}

function editFailed(err: unknown): ActionResult<never> {
  if (err instanceof QueueEditError) return invalid(err.message);
  if (err instanceof NotFoundError) return invalid(err.message);
  console.error(err);
  return invalid(EDIT_FAILED);
}

/** "Save changes" in a waiting post's drawer: caption and timing. */
export async function savePost(input: SavePostInput): Promise<ActionResult<QueueChange>> {
  const raw = input as unknown as Record<string, unknown> | null;
  const rawTiming = raw?.timing as Record<string, unknown> | null | undefined;
  if (
    !raw ||
    typeof raw.postId !== "string" ||
    !UUID.test(raw.postId) ||
    typeof raw.caption !== "string" ||
    !rawTiming ||
    (rawTiming.kind !== "queue" &&
      (rawTiming.kind !== "pinned" || typeof rawTiming.local !== "string"))
  ) {
    return invalid("That change can't be saved. Reload the page and try again.");
  }
  try {
    const { db, ctx } = await queueContext();
    let timing: ContentTiming = { kind: "queue" };
    if (input.timing.kind === "pinned") {
      const at = localInputToUtc(input.timing.local, ctx.timezone);
      if (!at) return invalid(EDIT_MESSAGES.pinned_invalid);
      timing = { kind: "pinned", at };
    }
    const saved = await editPost(db, ctx, input.postId, { caption: input.caption.trim(), timing });
    return refreshed({
      message: savedMessage(saved.timing, saved.scheduledAt, ctx.now, ctx.timezone),
    });
  } catch (err) {
    return editFailed(err);
  }
}

/** "Post now": the post becomes due now; the scheduler's next tick publishes it. */
export async function postNowAction(postId: string): Promise<ActionResult<QueueChange>> {
  if (typeof postId !== "string" || !UUID.test(postId)) return invalid(EDIT_FAILED);
  try {
    const { db, ctx } = await queueContext();
    await postNow(db, ctx, postId);
    return refreshed({ message: POST_NOW_MESSAGE });
  } catch (err) {
    return editFailed(err);
  }
}

/** "Remove from queue" (after the inline confirm). */
export async function removePostAction(postId: string): Promise<ActionResult<QueueChange>> {
  if (typeof postId !== "string" || !UUID.test(postId)) return invalid(EDIT_FAILED);
  try {
    const { db, ctx } = await queueContext();
    const removed = await removePost(db, ctx, postId);
    return refreshed({ message: removedMessage(removed.handle, removed.timing) });
  } catch (err) {
    return editFailed(err);
  }
}

/** The account drawer's slots: add or remove one; the account's queue is re-timed. */
export async function saveSlots(input: SaveSlotsInput): Promise<ActionResult<QueueChange>> {
  const raw = input as unknown as Record<string, unknown> | null;
  if (
    !raw ||
    typeof raw.accountId !== "string" ||
    !UUID.test(raw.accountId) ||
    typeof raw.handle !== "string" ||
    !Array.isArray(raw.before) ||
    !Array.isArray(raw.slots) ||
    raw.slots.length > SLOTS_MAX ||
    [...(raw.before as unknown[]), ...(raw.slots as unknown[])].some((s) => typeof s !== "string")
  ) {
    return invalid("Those slots can't be saved. Reload the page and try again.");
  }
  try {
    const { db, ctx } = await queueContext();
    const saved = await saveAccountSlots(db, ctx, input.accountId, input.slots);
    return refreshed({ message: slotsMessage(input.handle, input.before, saved) });
  } catch (err) {
    return editFailed(err);
  }
}
