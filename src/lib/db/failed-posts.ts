import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FAILED_MESSAGES,
  REPLACE_LOG,
  RETRY_LOG,
  removeProblem,
  replaceProblem,
  retryPatch,
  retryProblem,
  type FailedProblem,
  type FailedPostState,
} from "@/lib/domain/failed-posts";
import { insertMedia, replanAccount, type NewMedia, type QueueContext } from "./posts";
import { postsUsed24h, unclaimed } from "./queue-edit";
import type { Database } from "./types";
import { deletePublishedVideo } from "./videos";

/**
 * A failed post's drawer actions (BC-20): "Retry now", "Replace video" and "Remove". Like the
 * queue edits (queue-edit.ts), every write is one UPDATE that only applies while the post is still
 * failed and no tick holds it, and posting is left to the scheduler: a retry only makes the post
 * due again. See src/lib/domain/failed-posts.ts for the rules (a kept container is checked first,
 * so a post that is already live is recovered, never posted twice).
 */

type Db = SupabaseClient<Database>;

/** A refused action, with a message for the person who asked. */
export class FailedPostError extends Error {
  constructor(readonly code: FailedProblem) {
    super(FAILED_MESSAGES[code]);
    this.name = "FailedPostError";
  }
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`Changing a failed post failed at ${what}: ${error.message}`);
}

interface StoredFailedPost {
  id: string;
  account_id: string;
  media_id: string;
  status: Database["public"]["Enums"]["post_status"];
  container_id: string | null;
  social_accounts: { handle: string; status: string };
  media_assets: { storage_path: string };
}

async function loadFailed(
  db: Db,
  ctx: QueueContext,
  postId: string,
  withQuota = true,
): Promise<{ post: StoredFailedPost; state: FailedPostState }> {
  const res = await db
    .from("posts")
    .select(
      "id, account_id, media_id, status, container_id, social_accounts(handle, status), media_assets(storage_path)",
    )
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", postId)
    .maybeSingle();
  if (res.error) fail("reading the post", res.error);
  const post = res.data;
  if (post?.status !== "failed") throw new FailedPostError("not_failed");
  return {
    post,
    state: {
      status: post.status,
      containerId: post.container_id,
      accountStatus: post.social_accounts.status,
      postsUsed24h: withQuota ? await postsUsed24h(db, ctx, post.account_id) : 0,
    },
  };
}

/** Applies `patch` only while the post is still failed and no tick holds it. */
async function updateFailed(
  db: Db,
  ctx: QueueContext,
  postId: string,
  patch: Database["public"]["Tables"]["posts"]["Update"],
): Promise<void> {
  const res = await db
    .from("posts")
    .update(patch)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", postId)
    .eq("status", "failed")
    .or(unclaimed(new Date()))
    .select("id");
  if (res.error) fail("saving the post", res.error);
  if (res.data.length !== 1) throw new FailedPostError("not_failed");
}

/**
 * What follows a saved change (re-timing the queue, deleting an unused video, the log line). The
 * change itself is already saved, so a failure here is logged, not reported as a failed action.
 */
async function afterwards(what: string, steps: readonly Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(steps);
  for (const r of results) {
    if (r.status === "rejected") console.error(`After ${what}:`, r.reason);
  }
}

/** A line in the post's history (the drawer's attempts list). Best effort. */
async function logLine(db: Db, ctx: QueueContext, post: StoredFailedPost, message: string) {
  const res = await db.from("job_log").insert({
    workspace_id: ctx.workspaceId,
    kind: "publish",
    post_id: post.id,
    account_id: post.account_id,
    ok: true,
    message,
    at: ctx.now.toISOString(),
  });
  if (res.error) console.error(`Writing the job log failed: ${res.error.message}`);
}

/**
 * "Retry now": resets the retries and makes the post due now; the scheduler's next tick takes it
 * (with its own quota check). A kept container goes back to the scheduler to be checked first.
 */
export async function retryFailedPost(db: Db, ctx: QueueContext, postId: string): Promise<void> {
  const { post, state } = await loadFailed(db, ctx, postId);
  const problem = retryProblem(state);
  if (problem) throw new FailedPostError(problem);
  await updateFailed(db, ctx, postId, retryPatch(post.container_id, ctx.now));
  await afterwards("a retry", [
    logLine(db, ctx, post, RETRY_LOG),
    replanAccount(db, ctx, post.account_id),
  ]);
}

/**
 * "Replace video": the post gets a new (already checked) video and is retried with its caption;
 * the old video is deleted when no other waiting post uses it. Refused while the post keeps a
 * container (it may be live already; Retry checks that first).
 */
export async function replaceFailedVideo(
  db: Db,
  ctx: QueueContext,
  postId: string,
  media: NewMedia,
): Promise<void> {
  const { post, state } = await loadFailed(db, ctx, postId);
  const problem = replaceProblem(state);
  if (problem) throw new FailedPostError(problem);

  const mediaId = await insertMedia(db, ctx.workspaceId, media);

  try {
    await updateFailed(db, ctx, postId, {
      ...retryPatch(null, ctx.now),
      media_id: mediaId,
      container_id: null,
      container_created_at: null,
    });
  } catch (err) {
    // The post changed meanwhile: the new media row isn't used.
    await db.from("media_assets").delete().eq("workspace_id", ctx.workspaceId).eq("id", mediaId);
    throw err;
  }
  await afterwards("replacing a video", [
    logLine(db, ctx, post, REPLACE_LOG),
    replanAccount(db, ctx, post.account_id),
    deletePublishedVideo(db, {
      workspaceId: ctx.workspaceId,
      mediaId: post.media_id,
      postId,
      storagePath: post.media_assets.storage_path,
    }),
  ]);
}

/**
 * "Remove": marks the failed post `removed` (its log lines keep pointing at it) and deletes the
 * video when no other waiting post uses it. Refused while the post keeps a container (it may be
 * live; Retry settles that first). Returns the account's handle for the toast.
 */
export async function removeFailedPost(
  db: Db,
  ctx: QueueContext,
  postId: string,
): Promise<{ handle: string }> {
  const { post, state } = await loadFailed(db, ctx, postId, false);
  const problem = removeProblem(state);
  if (problem) throw new FailedPostError(problem);
  await updateFailed(db, ctx, postId, { status: "removed", next_attempt_at: null });
  await afterwards("removing a post", [
    replanAccount(db, ctx, post.account_id),
    deletePublishedVideo(db, {
      workspaceId: ctx.workspaceId,
      mediaId: post.media_id,
      postId,
      storagePath: post.media_assets.storage_path,
    }),
  ]);
  return { handle: post.social_accounts.handle };
}
