import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nowFor } from "@/lib/clock";
import {
  POSTED_DAYS,
  avatarIndex,
  buildCanvas,
  UPCOMING_STATUSES,
  type CanvasModel,
  type CanvasPostInput,
  type PostMetricsInput,
} from "@/lib/domain/canvas";
import { nextOpenSlot, type ContentAccount } from "@/lib/domain/content";
import {
  buildPostDetails,
  type AccountDetail,
  type PostDetail,
  type PostMetricRow,
} from "@/lib/domain/details";
import { loadAccountDetails } from "./details";
import { createServerSupabase } from "./server";
import type { Database } from "./types";
import { VIDEOS_BUCKET } from "./videos";
import { currentWorkspace, type Workspace } from "./workspace";

const THUMBNAIL_TTL_S = 60 * 60;
const DAY_MS = 86_400_000;

export interface WorkflowData extends CanvasModel {
  workspace: Pick<Workspace, "id" | "kind">;
  /** ISO; the workspace clock (frozen in a Sandbox scenario with `?now=`). */
  now: string;
  frozen: boolean;
  timezone: string;
  /** What the hover previews and drawers show (BC-15). */
  details: WorkflowDetails;
  /** The Add content dialog's "Post to" list (BC-14), in column order. */
  contentAccounts: ContentAccount[];
}

export interface WorkflowDetails {
  /** Every post on the canvas, by id. */
  posts: Record<string, PostDetail>;
  /** Every account, by id. */
  accounts: Record<string, AccountDetail>;
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`Loading the Workflow canvas failed at ${what}: ${error.message}`);
}

function date(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

/** Signed URLs for thumbnails; a thumbnail that can't be signed falls back to the placeholder. */
async function signThumbnails(
  db: SupabaseClient<Database>,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  try {
    const { data } = await db.storage
      .from(VIDEOS_BUCKET)
      .createSignedUrls([...paths], THUMBNAIL_TTL_S);
    for (const row of data ?? []) {
      if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
    }
  } catch {
    // No bucket yet (or Storage down): placeholders.
  }
  return out;
}

/**
 * Everything the Workflow canvas shows for the current workspace, in one call: accounts (in the
 * order they were added), their waiting posts, the last POSTED_DAYS days of posted ones with
 * their latest stats, and every failed post. Read as the signed-in user (RLS applies).
 */
export async function loadWorkflow(): Promise<WorkflowData> {
  const db = await createServerSupabase();
  const workspace = await currentWorkspace();
  const now = nowFor(workspace);
  const timezone = workspace.timezone ?? "UTC";
  const since = new Date(now.getTime() - (POSTED_DAYS + 1) * DAY_MS).toISOString();

  const [accounts, posts, accountDetails] = await Promise.all([
    db
      .from("social_accounts")
      .select("id, handle, platform, tags, slots, status, status_reason, followers, brands(name)")
      .eq("workspace_id", workspace.id)
      .order("created_at")
      .order("handle"),
    db
      .from("posts")
      .select(
        "id, account_id, caption, timing, queue_position, status, scheduled_at, published_at, last_error, attempts, permalink, media_assets(duration_s, thumbnail_path)",
      )
      .eq("workspace_id", workspace.id)
      .or(`status.in.(queued,paused,publishing,failed),published_at.gte.${since}`)
      .order("scheduled_at", { ascending: true, nullsFirst: false }),
    loadAccountDetails(db, workspace.id, now, timezone),
  ]);
  if (accounts.error) fail("accounts", accounts.error);
  if (posts.error) fail("posts", posts.error);

  const publishedIds = posts.data.filter((p) => p.status === "published").map((p) => p.id);
  const metrics = new Map<string, PostMetricsInput>();
  const metricRows: PostMetricRow[] = [];
  if (publishedIds.length > 0) {
    const res = await db
      .from("post_metrics")
      .select(
        "post_id, stat_offset, views, reach, likes, comments, shares, saves, taken_at, missed",
      )
      .eq("workspace_id", workspace.id)
      .in("post_id", publishedIds)
      .not("taken_at", "is", null)
      .order("taken_at", { ascending: false });
    if (res.error) fail("stats", res.error);
    for (const m of res.data) {
      if (!m.missed && !metrics.has(m.post_id)) metrics.set(m.post_id, m);
      metricRows.push({
        postId: m.post_id,
        offset: m.stat_offset,
        takenAt: date(m.taken_at),
        views: m.views,
        reach: m.reach,
        likes: m.likes,
        comments: m.comments,
        shares: m.shares,
        saves: m.saves,
        missed: m.missed,
      });
    }
  }

  const thumbPaths = posts.data
    .map((p) => p.media_assets.thumbnail_path)
    .filter((p): p is string => Boolean(p));
  const thumbs = await signThumbnails(db, thumbPaths);

  const postInputs: CanvasPostInput[] = posts.data.map((p) => ({
    id: p.id,
    accountId: p.account_id,
    caption: p.caption,
    timing: p.timing,
    queuePosition: p.queue_position,
    status: p.status,
    scheduledAt: date(p.scheduled_at),
    publishedAt: date(p.published_at),
    lastError: p.last_error,
    durationS: p.media_assets.duration_s,
    thumbnailUrl: p.media_assets.thumbnail_path
      ? (thumbs.get(p.media_assets.thumbnail_path) ?? null)
      : null,
  }));

  const model = buildCanvas({
    accounts: accounts.data.map((a) => ({
      id: a.id,
      handle: a.handle,
      brand: a.brands.name,
      platform: a.platform,
      tags: a.tags,
      slots: a.slots,
      status: a.status,
      statusReason: a.status_reason,
      followers: a.followers,
    })),
    posts: postInputs,
    metrics,
    now,
    timezone,
  });

  const details: WorkflowDetails = {
    posts: buildPostDetails(
      posts.data.map((p) => ({
        id: p.id,
        accountId: p.account_id,
        caption: p.caption,
        timing: p.timing,
        status: p.status,
        lastError: p.last_error,
        attempts: p.attempts,
        permalink: p.permalink,
      })),
      metricRows,
    ),
    accounts: Object.fromEntries(accountDetails.map((a) => [a.id, a])),
  };

  // Add content's account list: where a queued video would go now on each account.
  const waitingBy = new Map<string, CanvasPostInput[]>();
  for (const p of postInputs) {
    if (!UPCOMING_STATUSES.has(p.status)) continue;
    const list = waitingBy.get(p.accountId) ?? [];
    list.push(p);
    waitingBy.set(p.accountId, list);
  }
  const contentAccounts: ContentAccount[] = accounts.data.map((a) => {
    const posts = waitingBy.get(a.id) ?? [];
    const open = nextOpenSlot({ slots: a.slots, timezone, now, posts });
    return {
      id: a.id,
      handle: a.handle,
      platform: a.platform,
      avatar: avatarIndex(a.id),
      paused: a.status !== "ready",
      nextOpenSlot: open?.toISOString() ?? null,
    };
  });

  return {
    ...model,
    details,
    contentAccounts,
    workspace: { id: workspace.id, kind: workspace.kind },
    now: now.toISOString(),
    frozen: workspace.kind === "sandbox" && workspace.clockOverride !== null,
    timezone,
  };
}
