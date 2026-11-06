import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_CAPTION_LENGTH,
  holdDue,
  newPostStatus,
  nextQueuePosition,
  timeChanges,
  timingProblem,
  type ContentTiming,
  type ExistingPost,
} from "@/lib/domain/content";
import type { Database } from "./types";

type Db = SupabaseClient<Database>;

/**
 * Queues an uploaded video on one or more accounts (BC-14's Add content; BC-17's content API
 * reuses it with the service-role client and the API key's workspace).
 *
 * One `media_assets` row and one `posts` row per account: a queue post joins the back of the
 * account's backlog (`queue_position` after every other post), a pinned post keeps its time. Then
 * the queue planner (BC-4) times the account again and the changed `scheduled_at`s are saved.
 * Not one transaction (supabase-js has none): if a step fails, the rows written so far are
 * removed again. `queue_position` is unique per account (0007_api_keys.sql): an add that loses a
 * race for a position retries with the next one.
 */

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";
/** Tries at a free queue position before giving up. */
const POSITION_ATTEMPTS = 5;

export interface NewMedia {
  /** Path in the `videos` bucket; must start with `<workspace_id>/`. */
  storagePath: string;
  thumbnailPath: string | null;
  durationS: number;
  width: number;
  height: number;
  bytes: number;
}

/** The workspace a queue change happens in, and its clock. */
export interface QueueContext {
  workspaceId: string;
  /** Workspace timezone for slot maths. */
  timezone: string;
  now: Date;
}

export interface NewContent extends QueueContext {
  media: NewMedia;
  caption: string;
  accountIds: readonly string[];
  timing: ContentTiming;
}

export interface QueuedPost {
  id: string;
  accountId: string;
  handle: string;
  /** null: the account has no slots, the post waits in the backlog. */
  scheduledAt: Date | null;
  status: "queued" | "paused";
}

export interface QueuedContent {
  mediaId: string;
  posts: QueuedPost[];
}

export type ContentErrorCode =
  | "no_accounts"
  | "unknown_account"
  | "caption_too_long"
  | "pinned_past"
  | "pinned_invalid"
  | "bad_path";

/** A request that can't be queued, with a message for the person who sent it. */
export class ContentError extends Error {
  constructor(
    readonly code: ContentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContentError";
  }
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`Queueing the video failed at ${what}: ${error.message}`);
}

function validate(input: NewContent): string[] {
  const accountIds = [...new Set(input.accountIds)];
  if (accountIds.length === 0) {
    throw new ContentError("no_accounts", "Choose at least one account to post to.");
  }
  if (input.caption.length > MAX_CAPTION_LENGTH) {
    throw new ContentError(
      "caption_too_long",
      `The caption is ${input.caption.length} characters. Instagram allows ${MAX_CAPTION_LENGTH}.`,
    );
  }
  const problem = timingProblem(input.timing, input.now);
  if (problem === "pinned_past") {
    throw new ContentError("pinned_past", "The pinned time has passed. Choose a later time.");
  }
  if (problem === "pinned_invalid") {
    throw new ContentError("pinned_invalid", "Choose a date and time to pin the post to.");
  }
  checkMediaPaths(input.workspaceId, input.media);
  return accountIds;
}

/** The upload's files must be under the workspace's folder (ADR 0005). */
function checkMediaPaths(workspaceId: string, media: NewMedia): void {
  const prefix = `${workspaceId}/`;
  const paths = [media.storagePath, media.thumbnailPath].filter((p): p is string => p !== null);
  if (paths.some((p) => !p.startsWith(prefix) || p.includes(".."))) {
    throw new ContentError("bad_path", "The upload doesn't belong to this workspace.");
  }
}

/** Saves an uploaded video's `media_assets` row (paths checked first); returns its id. */
export async function insertMedia(db: Db, workspaceId: string, media: NewMedia): Promise<string> {
  checkMediaPaths(workspaceId, media);
  const res = await db
    .from("media_assets")
    .insert({
      workspace_id: workspaceId,
      storage_path: media.storagePath,
      thumbnail_path: media.thumbnailPath,
      duration_s: media.durationS,
      width: media.width,
      height: media.height,
      bytes: media.bytes,
    })
    .select("id")
    .single();
  if (res.error) fail("saving the video", res.error);
  return res.data.id;
}

/**
 * Re-times one account's queue (after a post joined or left it) and saves what changed. Returns
 * every waiting post's time.
 */
async function replan(
  db: Db,
  input: QueueContext,
  account: { id: string; slots: readonly string[] },
): Promise<Map<string, Date | null>> {
  const res = await db
    .from("posts")
    .select("id, timing, queue_position, scheduled_at, status, claimed_until")
    .eq("workspace_id", input.workspaceId)
    .eq("account_id", account.id)
    .in("status", ["queued", "paused", "publishing"]);
  if (res.error) fail("reading the queue", res.error);
  // Leases are real time, never the Sandbox clock.
  const realNow = new Date();
  const posts: ExistingPost[] = holdDue(
    res.data.map((p) => ({
      id: p.id,
      timing: p.timing,
      queuePosition: p.queue_position,
      scheduledAt: p.scheduled_at ? new Date(p.scheduled_at) : null,
      status: p.status,
      claimed: p.claimed_until !== null && new Date(p.claimed_until) > realNow,
    })),
    input.now,
  );
  const changes = timeChanges({
    slots: account.slots,
    timezone: input.timezone,
    now: input.now,
    posts,
  });
  const saved = await Promise.all(
    changes.map((change) =>
      db
        .from("posts")
        .update({ scheduled_at: change.scheduledAt?.toISOString() ?? null })
        .eq("workspace_id", input.workspaceId)
        .eq("id", change.id)
        // Never under a tick that claimed it meanwhile.
        .in("status", ["queued", "paused"])
        .or(`claimed_until.is.null,claimed_until.lt.${realNow.toISOString()}`),
    ),
  );
  for (const up of saved) if (up.error) fail("saving the queue times", up.error);
  const times = new Map(posts.map((p) => [p.id, p.scheduledAt]));
  for (const change of changes) times.set(change.id, change.scheduledAt);
  return times;
}

/**
 * Re-times one account's queue from its stored slots (after an edit, a removal or new slots) and
 * saves what changed. Returns every waiting post's time.
 */
export async function replanAccount(
  db: Db,
  ctx: QueueContext,
  accountId: string,
): Promise<Map<string, Date | null>> {
  const account = await db
    .from("social_accounts")
    .select("id, slots")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", accountId)
    .maybeSingle();
  if (account.error) fail("reading the account", account.error);
  if (!account.data) return new Map();
  return replan(db, ctx, account.data);
}

export async function queueContent(db: Db, input: NewContent): Promise<QueuedContent> {
  const accountIds = validate(input);
  const ws = input.workspaceId;

  const accounts = await db
    .from("social_accounts")
    .select("id, handle, slots, status")
    .eq("workspace_id", ws)
    .in("id", accountIds);
  if (accounts.error) fail("reading the accounts", accounts.error);
  const byId = new Map(accounts.data.map((a) => [a.id, a]));
  if (accountIds.some((id) => !byId.has(id))) {
    throw new ContentError("unknown_account", "One of the chosen accounts no longer exists.");
  }

  const mediaId = await insertMedia(db, ws, input.media);

  const created: string[] = [];
  const touched: { id: string; slots: string[] }[] = [];
  try {
    const out: QueuedPost[] = [];
    for (const accountId of accountIds) {
      const account = byId.get(accountId);
      if (!account) continue; // checked above
      const status = newPostStatus(account.status);
      // A queue post takes the next free position. Two adds racing on one account can pick the
      // same one; the unique index (0007) refuses the second insert and it tries the next.
      let post;
      for (let attempt = 0; ; attempt++) {
        let queuePosition: number | null = null;
        if (input.timing.kind === "queue") {
          const positions = await db
            .from("posts")
            .select("queue_position")
            .eq("workspace_id", ws)
            .eq("account_id", accountId)
            .not("queue_position", "is", null)
            .order("queue_position", { ascending: false })
            .limit(1);
          if (positions.error) fail("reading the queue", positions.error);
          queuePosition = nextQueuePosition(
            positions.data.map((p) => ({ queuePosition: p.queue_position })),
          );
        }
        post = await db
          .from("posts")
          .insert({
            workspace_id: ws,
            account_id: accountId,
            media_id: mediaId,
            caption: input.caption,
            timing: input.timing.kind,
            queue_position: queuePosition,
            scheduled_at: input.timing.kind === "pinned" ? input.timing.at.toISOString() : null,
            status,
          })
          .select("id")
          .single();
        if (post.error?.code !== UNIQUE_VIOLATION || attempt >= POSITION_ATTEMPTS - 1) break;
      }
      if (post.error) fail("saving the post", post.error);
      created.push(post.data.id);
      touched.push(account);
      const scheduledAt = (await replan(db, input, account)).get(post.data.id) ?? null;
      out.push({ id: post.data.id, accountId, handle: account.handle, scheduledAt, status });
    }
    return { mediaId, posts: out };
  } catch (err) {
    // Undo: the posts, the media, and the times a pin pushed back. Best effort: the first error
    // is the one worth reporting.
    try {
      if (created.length) await db.from("posts").delete().eq("workspace_id", ws).in("id", created);
      await db.from("media_assets").delete().eq("workspace_id", ws).eq("id", mediaId);
      for (const account of touched) await replan(db, input, account);
    } catch (undo) {
      console.error("Undoing a failed queueContent failed:", undo);
    }
    throw err;
  }
}
