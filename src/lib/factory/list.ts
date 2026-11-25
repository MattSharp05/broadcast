import "server-only";
import { nowFor } from "@/lib/clock";
import { createAdminSupabase } from "@/lib/db/admin";
import { fail } from "@/lib/db/factory";
import { createServerSupabase } from "@/lib/db/server";
import { VIDEOS_BUCKET } from "@/lib/db/videos";
import { currentWorkspace } from "@/lib/db/workspace";
import { STEP_LABELS } from "@/lib/domain/factory/steps";
import {
  cardLine,
  inFilter,
  LIST_FILTERS,
  type ListFacts,
  type ListFilter,
} from "@/lib/domain/factory/list";
import { ago, whenLabel } from "@/lib/domain/format";
import { signedUrlFor } from "./assets";

/**
 * The studio list (BC-42): one card per video with its newest version, what state it is in and
 * the last thing that happened, sorted by last activity. Reads as the signed-in user (RLS).
 */

export interface VideoCard {
  id: string;
  title: string;
  handle: string | null;
  status: string;
  line: string;
  /** The newest version's proxy (or file), signed: its first frame is the thumbnail. */
  thumbUrl: string | null;
  lastIntent: string | null;
  lastAgo: string;
  /** For sorting: the last activity, ms. */
  lastAt: number;
  filters: ListFilter[];
}

const SIGN_TTL_S = 2 * 60 * 60;

export async function loadStudioList(): Promise<VideoCard[]> {
  const db = await createServerSupabase();
  const workspace = await currentWorkspace();
  const ws = workspace.id;
  const now = nowFor(workspace);
  const timezone = workspace.timezone ?? "UTC";
  const [prods, accounts, versions, notes, batches, packs, events, steps] = await Promise.all([
    db.from("productions").select("*").eq("workspace_id", ws),
    db.from("social_accounts").select("id, handle").eq("workspace_id", ws),
    db
      .from("production_versions")
      .select("production_id, number, proxy_path, media_id")
      .eq("workspace_id", ws)
      .order("number", { ascending: false }),
    db.from("review_notes").select("production_id, status").eq("workspace_id", ws),
    db
      .from("review_batches")
      .select("production_id")
      .eq("workspace_id", ws)
      .in("status", ["sent", "running"]),
    db
      .from("delivery_packs")
      .select("production_id")
      .eq("workspace_id", ws)
      .not("ready_at", "is", null),
    db
      .from("production_events")
      .select("production_id, intent, created_at")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("production_steps")
      .select("production_id, step, status")
      .eq("workspace_id", ws)
      .in("status", ["waiting", "running", "failed"]),
  ]);
  for (const r of [prods, accounts, versions, notes, batches, packs, events, steps])
    if (r.error) fail("reading the studio list", r.error);

  const postIds = (prods.data ?? []).map((p) => p.post_id).filter((x): x is string => Boolean(x));
  const posts = postIds.length
    ? await db
        .from("posts")
        .select("id, status, scheduled_at, published_at")
        .eq("workspace_id", ws)
        .in("id", postIds)
    : { data: [], error: null };
  if (posts.error) fail("reading the posts", posts.error);
  const mediaIds = (versions.data ?? [])
    .map((v) => v.media_id)
    .filter((x): x is string => Boolean(x));
  const media = mediaIds.length
    ? await db
        .from("media_assets")
        .select("id, storage_path")
        .eq("workspace_id", ws)
        .in("id", mediaIds)
    : { data: [], error: null };
  if (media.error) fail("reading the videos", media.error);

  const admin = createAdminSupabase();
  const sign = async (value: string | null | undefined): Promise<string | null> => {
    if (!value) return null;
    if (value.startsWith("storage:")) {
      const url = await signedUrlFor(admin, value, ws, SIGN_TTL_S);
      return url.startsWith("storage:") ? null : url;
    }
    if (value.startsWith(`${ws}/`)) {
      const { data } = await admin.storage.from(VIDEOS_BUCKET).createSignedUrl(value, SIGN_TTL_S);
      return data?.signedUrl ?? null;
    }
    return value.startsWith("/") || value.startsWith("https://") ? value : null;
  };
  const handle = new Map((accounts.data ?? []).map((a) => [a.id, a.handle]));
  const mediaPath = new Map(media.data.map((m) => [m.id, m.storage_path]));
  const postOf = new Map(posts.data.map((p) => [p.id, p]));

  const cards = await Promise.all(
    (prods.data ?? []).map(async (p) => {
      const newest = (versions.data ?? []).find((v) => v.production_id === p.id) ?? null;
      const own = (notes.data ?? []).filter((n) => n.production_id === p.id);
      const step = (steps.data ?? []).find((s) => s.production_id === p.id);
      const post = p.post_id ? postOf.get(p.post_id) : undefined;
      const postWhen = post?.published_at ?? post?.scheduled_at ?? null;
      const last = (events.data ?? []).find((e) => e.production_id === p.id);
      const facts: ListFacts = {
        status: p.status,
        newestVersion: newest?.number ?? null,
        openNotes: own.filter((n) => n.status === "draft" || n.status === "sent").length,
        answersToRead: own.filter((n) => n.status === "answered" || n.status === "not_changed")
          .length,
        batchOpen: (batches.data ?? []).some((b) => b.production_id === p.id),
        readyPack: (packs.data ?? []).some((k) => k.production_id === p.id),
        post: post
          ? {
              status: post.status,
              when: postWhen ? whenLabel(new Date(postWhen), now, timezone) : "",
            }
          : null,
        stepLabel: step ? STEP_LABELS[step.step] : null,
      };
      const lastAt = new Date(last?.created_at ?? p.updated_at).getTime();
      return {
        id: p.id,
        title: p.title || p.idea || "Untitled video",
        handle: p.account_id ? (handle.get(p.account_id) ?? null) : null,
        status: p.status,
        line: cardLine(facts),
        thumbUrl: newest
          ? await sign(
              newest.proxy_path ?? (newest.media_id ? mediaPath.get(newest.media_id) : null),
            )
          : null,
        lastIntent: last?.intent ?? null,
        lastAgo: ago(new Date(lastAt), now),
        lastAt,
        filters: LIST_FILTERS.map((f) => f.key).filter((k) => inFilter(k, facts)),
      };
    }),
  );
  return cards.sort((a, b) => b.lastAt - a.lastAt);
}
