import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentTiming } from "@/lib/domain/content";
import {
  EDITABLE_STATUSES,
  EDIT_MESSAGES,
  editProblem,
  isEditable,
  postNowProblem,
  timingPatch,
  type EditProblem,
} from "@/lib/domain/queue-edit";
import { newPostStatus } from "@/lib/domain/content";
import {
  MOVE_MESSAGES,
  backlogOrder,
  moveProblem,
  positionChanges,
  reorder,
  slotPlacement,
  undoPlacement,
  type MoveProblem,
  type MoveTarget,
  type QueueRow,
} from "@/lib/domain/move";
import type { PostTiming } from "@/lib/domain/queue";
import { replanAccount, type QueueContext } from "./posts";
import type { Database } from "./types";
import { deletePublishedVideo } from "./videos";

/**
 * Editing a waiting post from the post drawer (BC-18): caption and timing, "Post now" and
 * "Remove from queue". Every write is conditional on the post still waiting (queued or paused)
 * and not claimed by a tick, in the same UPDATE/DELETE, so the dashboard never races the
 * scheduler: a post the scheduler holds can't be changed or removed, and once the dashboard has
 * changed it the claim's own `WHERE` sees the new row. Posting itself is left to the scheduler:
 * "Post now" only makes the post due now.
 */

type Db = SupabaseClient<Database>;

/** A refused edit, with a message for the person who made it. */
export class QueueEditError extends Error {
  constructor(readonly code: EditProblem) {
    super(EDIT_MESSAGES[code]);
    this.name = "QueueEditError";
  }
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`Editing the queue failed at ${what}: ${error.message}`);
}

const DAY_MS = 86_400_000;

interface StoredPost {
  id: string;
  account_id: string;
  media_id: string;
  timing: PostTiming;
  queue_position: number | null;
  scheduled_at: string | null;
  status: Database["public"]["Enums"]["post_status"];
  social_accounts: { handle: string; status: string };
  media_assets: { storage_path: string };
}

async function loadPost(db: Db, ctx: QueueContext, postId: string): Promise<StoredPost> {
  const res = await db
    .from("posts")
    .select(
      "id, account_id, media_id, timing, queue_position, scheduled_at, status, social_accounts(handle, status), media_assets(storage_path)",
    )
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", postId)
    .maybeSingle();
  if (res.error) fail("reading the post", res.error);
  if (!res.data || !isEditable(res.data.status)) throw new QueueEditError("not_editable");
  return res.data;
}

/** `claimed_until` is real time (the lease), never the Sandbox clock. */
function unclaimed(realNow: Date): string {
  return `claimed_until.is.null,claimed_until.lt.${realNow.toISOString()}`;
}

/** Applies `patch` only while the post still waits and no tick holds it. */
async function updateWaiting(
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
    .in("status", [...EDITABLE_STATUSES])
    .or(unclaimed(new Date()))
    .select("id");
  if (res.error) fail("saving the post", res.error);
  if (res.data.length !== 1) throw new QueueEditError("not_editable");
}

export interface PostEdit {
  caption: string;
  timing: ContentTiming;
}

export interface EditedPost {
  timing: PostTiming;
  /** The post's time after the queue was re-timed (null: no slots, it waits in the backlog). */
  scheduledAt: Date | null;
}

/** Saves a new caption and timing, then re-times the account's queue. */
export async function editPost(
  db: Db,
  ctx: QueueContext,
  postId: string,
  edit: PostEdit,
): Promise<EditedPost> {
  const problem = editProblem(edit, ctx.now);
  if (problem) throw new QueueEditError(problem);
  const post = await loadPost(db, ctx, postId);

  let positions: { queuePosition: number | null }[] = [];
  if (edit.timing.kind === "queue" && post.timing !== "queue" && post.queue_position === null) {
    const res = await db
      .from("posts")
      .select("queue_position")
      .eq("workspace_id", ctx.workspaceId)
      .eq("account_id", post.account_id)
      .not("queue_position", "is", null);
    if (res.error) fail("reading the queue", res.error);
    positions = res.data.map((p) => ({ queuePosition: p.queue_position }));
  }
  const next = timingPatch(
    {
      timing: post.timing,
      queuePosition: post.queue_position,
      scheduledAt: post.scheduled_at ? new Date(post.scheduled_at) : null,
    },
    edit.timing,
    positions,
  );
  const retimed = edit.timing.kind === "pinned" || post.timing !== "queue";
  await updateWaiting(db, ctx, postId, {
    caption: edit.caption,
    timing: next.timing,
    queue_position: next.queuePosition,
    scheduled_at: next.scheduledAt?.toISOString() ?? null,
    // A new time the user chose wins over an earlier retry or quota wait.
    ...(retimed ? { next_attempt_at: null } : {}),
  });
  const times = await replanAccount(db, ctx, post.account_id);
  return {
    timing: next.timing,
    scheduledAt: times.has(postId) ? (times.get(postId) ?? null) : next.scheduledAt,
  };
}

/**
 * "Post now": pins the post to now so the scheduler's next tick claims and publishes it (with its
 * own quota check). Refused for paused accounts and full quotas. Later queue posts move up.
 */
export async function postNow(db: Db, ctx: QueueContext, postId: string): Promise<void> {
  const post = await loadPost(db, ctx, postId);
  const since = new Date(ctx.now.getTime() - DAY_MS).toISOString();
  const used = await db
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspaceId)
    .eq("account_id", post.account_id)
    .or(`status.eq.publishing,and(status.eq.published,published_at.gt.${since})`);
  if (used.error) fail("reading the quota", used.error);
  const problem = postNowProblem({
    status: post.status,
    accountStatus: post.social_accounts.status,
    postsUsed24h: used.count ?? 0,
  });
  if (problem) throw new QueueEditError(problem);

  await updateWaiting(db, ctx, postId, {
    timing: "pinned",
    scheduled_at: ctx.now.toISOString(),
    next_attempt_at: null,
  });
  await replanAccount(db, ctx, post.account_id);
}

export interface RemovedPost {
  handle: string;
  timing: PostTiming;
}

/**
 * "Remove from queue": marks the post `removed` (its log lines keep pointing at it), re-times the
 * account's queue (later posts move up) and deletes the video when no other waiting post uses it
 * (the thumbnail stays, like after publishing).
 */
export async function removePost(db: Db, ctx: QueueContext, postId: string): Promise<RemovedPost> {
  const post = await loadPost(db, ctx, postId);
  await updateWaiting(db, ctx, postId, { status: "removed", next_attempt_at: null });
  await Promise.all([
    replanAccount(db, ctx, post.account_id),
    deletePublishedVideo(db, {
      workspaceId: ctx.workspaceId,
      mediaId: post.media_id,
      postId,
      storagePath: post.media_assets.storage_path,
    }),
  ]);
  return { handle: post.social_accounts.handle, timing: post.timing };
}

// ── Moving a post (BC-22) ──────────────────────────────────────────────────────────────────────

/** A refused move, with a message for the person who made it. */
export class MoveError extends Error {
  constructor(readonly code: MoveProblem) {
    super(MOVE_MESSAGES[code]);
    this.name = "MoveError";
  }
}

export interface MovedPost {
  handle: string;
  /** The post's time after both queues were re-timed (null: it waits in the backlog). */
  scheduledAt: Date | null;
  /** Moves the post back where it was. */
  undo: MoveTarget;
}

async function queueRows(db: Db, ctx: QueueContext, accountId: string): Promise<QueueRow[]> {
  const res = await db
    .from("posts")
    .select("id, timing, queue_position, scheduled_at, status, claimed_until")
    .eq("workspace_id", ctx.workspaceId)
    .eq("account_id", accountId)
    .in("status", ["queued", "paused", "publishing"]);
  if (res.error) fail("reading the queue", res.error);
  const realNow = new Date();
  return res.data.map((p) => ({
    id: p.id,
    timing: p.timing,
    queuePosition: p.queue_position,
    scheduledAt: p.scheduled_at ? new Date(p.scheduled_at) : null,
    status: p.status,
    claimed: p.claimed_until !== null && new Date(p.claimed_until) > realNow,
  }));
}

/**
 * Moves a waiting post to a place in a queue: the same account (a new place in its backlog, or a
 * slot's time) or another account (same video and caption). The post's own change is one guarded
 * UPDATE (still waiting, not claimed by a tick); other backlog posts are renumbered only when the
 * moved post doesn't fit between its neighbours. Both accounts' queues are re-timed afterwards.
 */
export async function movePost(
  db: Db,
  ctx: QueueContext,
  postId: string,
  target: MoveTarget,
): Promise<MovedPost> {
  const res = await db
    .from("posts")
    .select(
      "id, account_id, timing, queue_position, scheduled_at, status, social_accounts(platform)",
    )
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", postId)
    .maybeSingle();
  if (res.error) fail("reading the post", res.error);
  const post = res.data;
  if (!post || !isEditable(post.status)) throw new MoveError("not_editable");

  const acc = await db
    .from("social_accounts")
    .select("id, handle, status, slots, platform")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", target.accountId)
    .maybeSingle();
  if (acc.error) fail("reading the account", acc.error);
  const account = acc.data;
  const problem = moveProblem({
    status: post.status,
    sourcePlatform: post.social_accounts.platform,
    target: account,
    placement: target.placement,
    now: ctx.now,
  });
  if (problem || !account) throw new MoveError(problem ?? "unknown_account");

  const sameAccount = post.account_id === account.id;
  const targetRows = await queueRows(db, ctx, account.id);
  const sourceRows = sameAccount ? targetRows : await queueRows(db, ctx, post.account_id);
  const undo: MoveTarget = {
    accountId: post.account_id,
    placement: undoPlacement(
      {
        id: post.id,
        timing: post.timing,
        scheduledAt: post.scheduled_at ? new Date(post.scheduled_at) : null,
      },
      backlogOrder(sourceRows),
    ),
  };

  const { placement } = target;
  let pinAt: Date | null = null;
  let after: string | null | "back" = "back";
  if (placement.kind === "pinned") pinAt = placement.at;
  else if (placement.kind === "queue") after = placement.after;
  else if (placement.kind === "slot") {
    const lands = slotPlacement({
      rows: targetRows,
      movedId: post.id,
      at: placement.at,
      slots: account.slots,
      timezone: ctx.timezone,
      now: ctx.now,
    });
    if (lands === "pinned") pinAt = placement.at;
  }

  let renumber: { id: string; queuePosition: number }[] = [];
  let queuePosition: number | null = sameAccount ? post.queue_position : null;
  if (!pinAt) {
    const backlog = backlogOrder(targetRows);
    const order = reorder(backlog, post.id, after);
    if (!order) throw new MoveError("unknown_position");
    const current = new Map(backlog.map((p) => [p.id, p.queuePosition]));
    const changes = positionChanges(order, current, post.id);
    queuePosition = changes.find((c) => c.id === post.id)?.queuePosition ?? queuePosition;
    renumber = changes.filter((c) => c.id !== post.id);
  }

  try {
    await updateWaiting(db, ctx, postId, {
      account_id: account.id,
      status: newPostStatus(account.status),
      timing: pinAt ? "pinned" : "queue",
      queue_position: queuePosition,
      scheduled_at: pinAt?.toISOString() ?? null,
      next_attempt_at: null,
    });
  } catch (err) {
    // Claimed by a tick (or published) since it was read.
    if (err instanceof QueueEditError) throw new MoveError("not_editable");
    throw err;
  }
  const realNow = new Date();
  const saved = await Promise.all(
    renumber.map((c) =>
      db
        .from("posts")
        .update({ queue_position: c.queuePosition })
        .eq("workspace_id", ctx.workspaceId)
        .eq("id", c.id)
        .in("status", [...EDITABLE_STATUSES])
        .or(unclaimed(realNow)),
    ),
  );
  for (const up of saved) if (up.error) fail("saving the queue order", up.error);

  const [times] = await Promise.all([
    replanAccount(db, ctx, account.id),
    sameAccount ? null : replanAccount(db, ctx, post.account_id),
  ]);
  return {
    handle: account.handle,
    scheduledAt: times.has(postId) ? (times.get(postId) ?? null) : pinAt,
    undo,
  };
}
