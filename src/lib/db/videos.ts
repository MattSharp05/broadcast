import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

type Db = SupabaseClient<Database>;

/** Bucket holding uploaded videos and their thumbnails (ADR 0005). */
export const VIDEOS_BUCKET = "videos";
/** How long Instagram may take to download a video for a container. */
export const VIDEO_URL_TTL_S = 3600;

/** A one-hour signed URL for a video, for the platform to download it. */
export async function signVideoUrl(db: Db, storagePath: string): Promise<string> {
  const { data, error } = await db.storage
    .from(VIDEOS_BUCKET)
    .createSignedUrl(storagePath, VIDEO_URL_TTL_S);
  if (error || !data.signedUrl) {
    throw new Error(`Signing the video URL failed: ${error?.message ?? "no URL"}`);
  }
  return data.signedUrl;
}

/** Statuses of posts that may still need their video. */
const NEEDS_VIDEO = ["queued", "publishing", "paused", "failed"] as const;

/**
 * After publishing: deletes the video file from Storage and marks the media `deleted_at`; the
 * thumbnail stays. Skipped while another post of the same media still waits to go out. Best
 * effort: a missing bucket (uploads come with BC-14) or a Storage error leaves the file and the
 * row as they are, and says why.
 */
export async function deletePublishedVideo(
  db: Db,
  input: { workspaceId: string; mediaId: string; postId: string; storagePath: string },
): Promise<"deleted" | "in_use" | "skipped"> {
  const others = await db
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId)
    .eq("media_id", input.mediaId)
    .neq("id", input.postId)
    .in("status", [...NEEDS_VIDEO]);
  if (others.error) {
    console.error(`Checking the video's other posts failed: ${others.error.message}`);
    return "skipped";
  }
  if ((others.count ?? 0) > 0) return "in_use";

  try {
    const removed = await db.storage.from(VIDEOS_BUCKET).remove([input.storagePath]);
    if (removed.error) {
      console.error(`Deleting the published video failed: ${removed.error.message}`);
      return "skipped";
    }
  } catch (err) {
    console.error("Deleting the published video failed:", err);
    return "skipped";
  }
  const marked = await db
    .from("media_assets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.mediaId);
  if (marked.error) console.error(`Marking the video deleted failed: ${marked.error.message}`);
  return "deleted";
}
