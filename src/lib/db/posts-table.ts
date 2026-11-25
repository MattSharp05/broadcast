import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stylePack } from "@/lib/domain/factory/styles";
import {
  METRICS,
  rowTitle,
  unionTags,
  type Counts,
  type PostRow,
  type PostStatus,
  type Snapshot,
} from "@/lib/domain/posts-table";
import { addTag, cleanTag } from "@/lib/domain/tags";
import { SAMPLE_PREFIX, signThumbnails } from "./canvas";
import type { Database } from "./types";

type Db = SupabaseClient<Database>;

function fail(what: string, error: { message: string }): never {
  throw new Error(`Loading the posts table failed at ${what}: ${error.message}`);
}

interface ProductionLink {
  id: string;
  title: string;
  idea: string;
  genre: string | null;
  tags: string[];
  style: string | null;
  voice_key: string | null;
  music_key: string | null;
  script: unknown;
  post_id: string | null;
  media_id: string | null;
  routine_id: string | null;
}

interface Recipe {
  production_id?: string;
  style?: string | null;
  voice?: string | null;
  music?: string | null;
  hook?: string | null;
}

/**
 * Finds each post's Content Factory video: the one that queued it (`post_id`), else the one whose
 * chosen render it posts (`media_id`), else the one its media recipe names.
 */
export function productionFor<P extends Pick<ProductionLink, "id" | "post_id" | "media_id">>(
  post: { id: string; media_id: string; recipe: Recipe | null },
  productions: readonly P[],
): P | null {
  return (
    productions.find((p) => p.post_id === post.id) ??
    productions.find((p) => p.media_id === post.media_id) ??
    (post.recipe?.production_id
      ? productions.find((p) => p.id === post.recipe?.production_id)
      : undefined) ??
    null
  );
}

function scriptLines(script: unknown): string[] {
  const lines = (script as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lines)) return [];
  return lines
    .map((l) => (l && typeof l === "object" ? (l as { text?: unknown }).text : null))
    .filter((t): t is string => typeof t === "string");
}

function scriptHook(script: unknown): string | null {
  const hook = (script as { hook?: unknown } | null)?.hook;
  return typeof hook === "string" && hook.trim() ? hook : null;
}

/**
 * Every post of the workspace that isn't removed, with its video's recipe, its routine and every
 * stats snapshot taken. Read as the signed-in user (RLS applies); every query names the workspace.
 */
export async function loadPostsTable(db: Db, workspaceId: string): Promise<PostRow[]> {
  const [posts, productions, routines, voices, music, metrics] = await Promise.all([
    db
      .from("posts")
      .select(
        "id, account_id, media_id, caption, status, scheduled_at, published_at, created_at, permalink, tags, social_accounts(handle), media_assets(thumbnail_path, cover_path, recipe)",
      )
      .eq("workspace_id", workspaceId)
      .neq("status", "removed")
      .order("created_at", { ascending: false }),
    db
      .from("productions")
      .select(
        "id, title, idea, genre, tags, style, voice_key, music_key, script, post_id, media_id, routine_id",
      )
      .eq("workspace_id", workspaceId)
      .or("post_id.not.is.null,media_id.not.is.null"),
    db.from("routines").select("id, name").eq("workspace_id", workspaceId),
    db.from("factory_voices").select("key, label"),
    db.from("factory_music").select("key, title"),
    db
      .from("post_metrics")
      .select(
        "post_id, stat_offset, taken_at, missed, views, likes, comments, shares, saves, reach",
      )
      .eq("workspace_id", workspaceId)
      .not("taken_at", "is", null)
      .eq("missed", false),
  ]);
  if (posts.error) fail("posts", posts.error);
  if (productions.error) fail("videos", productions.error);
  if (routines.error) fail("routines", routines.error);
  if (voices.error) fail("voices", voices.error);
  if (music.error) fail("music", music.error);
  if (metrics.error) fail("stats", metrics.error);

  const routineName = new Map(routines.data.map((r) => [r.id, r.name]));
  const voiceLabel = new Map(voices.data.map((v) => [v.key, v.label]));
  const musicTitle = new Map(music.data.map((m) => [m.key, m.title]));
  const snapshots = new Map<string, Snapshot[]>();
  for (const m of metrics.data) {
    if (!m.taken_at) continue;
    const values = Object.fromEntries(METRICS.map((k) => [k, m[k]])) as Counts;
    const list = snapshots.get(m.post_id) ?? [];
    list.push({ offset: m.stat_offset, takenAt: m.taken_at, values });
    snapshots.set(m.post_id, list);
  }

  const imageOf = (m: { thumbnail_path: string | null; cover_path: string | null }) =>
    m.cover_path ?? m.thumbnail_path;
  const paths = posts.data.map((p) => imageOf(p.media_assets)).filter((p): p is string => !!p);
  const thumbs = await signThumbnails(
    db,
    paths.filter((p) => !p.startsWith(SAMPLE_PREFIX)),
  );
  for (const p of paths) if (p.startsWith(SAMPLE_PREFIX)) thumbs.set(p, p);

  return posts.data.map((p): PostRow => {
    const recipe = (p.media_assets.recipe ?? null) as Recipe | null;
    const prod = productionFor({ id: p.id, media_id: p.media_id, recipe }, productions.data);
    const style = prod?.style ?? recipe?.style ?? null;
    const voice = prod?.voice_key ?? recipe?.voice ?? null;
    const song = prod?.music_key ?? recipe?.music ?? null;
    return {
      id: p.id,
      productionId: prod?.id ?? null,
      accountId: p.account_id,
      handle: p.social_accounts.handle,
      status: p.status as PostStatus,
      scheduledAt: p.scheduled_at,
      publishedAt: p.published_at,
      createdAt: p.created_at,
      title: rowTitle(prod?.title, p.caption),
      thumbnailUrl: thumbs.get(imageOf(p.media_assets) ?? "") ?? null,
      idea: prod?.idea ?? "",
      hook: scriptHook(prod?.script) ?? recipe?.hook ?? null,
      script: scriptLines(prod?.script),
      caption: p.caption,
      permalink: p.permalink,
      genre: prod?.genre ?? null,
      style,
      styleLabel: style ? (stylePack(style)?.label ?? style) : null,
      voice,
      voiceLabel: voice ? (voiceLabel.get(voice) ?? voice) : null,
      music: song,
      musicLabel: song ? (musicTitle.get(song) ?? song) : null,
      routineId: prod?.routine_id ?? null,
      routineName: prod?.routine_id ? (routineName.get(prod.routine_id) ?? null) : null,
      tags: unionTags(prod?.tags ?? [], p.tags),
      snapshots: snapshots.get(p.id) ?? [],
    };
  });
}

export class TagError extends Error {}

/**
 * Adds or removes one tag on posts. A post from a Content Factory video keeps its tags on the
 * video (`productions.tags`), anything else on the post. Removing takes the tag off both, since
 * a row shows their union. Returns each post's tags afterwards.
 */
export async function applyPostTag(
  db: Db,
  workspaceId: string,
  postIds: readonly string[],
  raw: string,
  op: "add" | "remove",
): Promise<Record<string, string[]>> {
  const tag = cleanTag(raw);
  if (!tag) throw new TagError("Type a tag first.");
  const lower = tag.toLowerCase();
  const posts = await db
    .from("posts")
    .select("id, media_id, tags, media_assets(recipe)")
    .eq("workspace_id", workspaceId)
    .in("id", [...postIds]);
  if (posts.error) fail("posts", posts.error);
  const mediaIds = posts.data.map((p) => p.media_id);
  const productions = await db
    .from("productions")
    .select("id, tags, post_id, media_id")
    .eq("workspace_id", workspaceId)
    .or(
      [
        `post_id.in.(${postIds.join(",")})`,
        mediaIds.length ? `media_id.in.(${mediaIds.join(",")})` : null,
      ]
        .filter(Boolean)
        .join(","),
    );
  if (productions.error) fail("videos", productions.error);

  // Tags already used anywhere in the workspace keep their spelling ("trip" joins "Trip").
  const [usedOnPosts, usedOnVideos] = await Promise.all([
    db.from("posts").select("tags").eq("workspace_id", workspaceId),
    db.from("productions").select("tags").eq("workspace_id", workspaceId),
  ]);
  if (usedOnPosts.error) fail("tags in use", usedOnPosts.error);
  if (usedOnVideos.error) fail("tags in use", usedOnVideos.error);
  const inUse = [...usedOnPosts.data, ...usedOnVideos.data].flatMap((r) => r.tags);
  const next = (tags: string[]) =>
    op === "add"
      ? (addTag(tags, tag, inUse) ?? tags)
      : tags.some((t) => t.toLowerCase() === lower)
        ? tags.filter((t) => t.toLowerCase() !== lower)
        : tags;

  const result: Record<string, string[]> = {};
  const prodTags = new Map(productions.data.map((p) => [p.id, p.tags]));
  for (const post of posts.data) {
    const recipe = (post.media_assets.recipe ?? null) as Recipe | null;
    const prod = productionFor({ id: post.id, media_id: post.media_id, recipe }, productions.data);
    let postTags = post.tags;
    let videoTags = prod ? (prodTags.get(prod.id) ?? []) : [];
    if (prod) {
      const updated = next(videoTags);
      if (updated !== videoTags) {
        const { error } = await db
          .from("productions")
          .update({ tags: updated })
          .eq("workspace_id", workspaceId)
          .eq("id", prod.id);
        if (error) fail("saving the video's tags", error);
        videoTags = updated;
        prodTags.set(prod.id, updated);
      }
    }
    if (!prod || op === "remove") {
      const updated = next(postTags);
      if (updated !== postTags) {
        const { error } = await db
          .from("posts")
          .update({ tags: updated })
          .eq("workspace_id", workspaceId)
          .eq("id", post.id);
        if (error) fail("saving the post's tags", error);
        postTags = updated;
      }
    }
    result[post.id] = unionTags(videoTags, postTags);
  }
  return result;
}
