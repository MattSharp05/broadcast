import type { SupabaseClient } from "@supabase/supabase-js";
import { probeMp4, type Mp4Info } from "@/lib/media/mp4";
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
 * effort: a Storage error leaves the file and the
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

/** Where an upload's files live in the bucket (ADR 0005): under the workspace id. */
export function uploadPaths(
  workspaceId: string,
  uploadId: string,
  contentType: "video/mp4" | "video/quicktime",
): { video: string; thumbnail: string } {
  const ext = contentType === "video/quicktime" ? "mov" : "mp4";
  return {
    video: `${workspaceId}/videos/${uploadId}.${ext}`,
    thumbnail: `${workspaceId}/thumbnails/${uploadId}.jpg`,
  };
}

/** A signed URL the browser can PUT one file to (valid for 2 hours, Storage's fixed lifetime). */
export async function signUploadUrl(db: Db, storagePath: string): Promise<string> {
  const { data, error } = await db.storage.from(VIDEOS_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data.signedUrl) {
    throw new Error(`Signing the upload URL failed: ${error?.message ?? "no URL"}`);
  }
  return data.signedUrl;
}

/** Thrown when an uploaded video can't be found or read in Storage. */
export class StoredVideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoredVideoError";
  }
}

/**
 * Reads an uploaded video's size, duration, display size and codec straight from Storage with
 * HTTP Range requests (headers and the `moov` box only; never the whole file). The server's own
 * check of what was uploaded: it doesn't take the browser's word for it.
 */
export async function probeStoredVideo(
  db: Db,
  storagePath: string,
): Promise<{ bytes: number; info: Mp4Info }> {
  let url: string;
  try {
    url = await signVideoUrl(db, storagePath);
  } catch {
    throw new StoredVideoError("The uploaded video wasn't found. Upload it again.");
  }
  const seen: { size: number | null } = { size: null };
  let whole: Uint8Array | null = null;
  const read = async (offset: number, length: number): Promise<Uint8Array> => {
    if (whole) return whole.subarray(offset, offset + length);
    const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (res.status === 200) {
      // Range not honoured: keep the body and serve every later read from it.
      whole = new Uint8Array(await res.arrayBuffer());
      seen.size ??= whole.length;
      return whole.subarray(offset, offset + length);
    }
    if (res.status === 416) return new Uint8Array(0);
    if (res.status !== 206) {
      throw new StoredVideoError("The uploaded video wasn't found. Upload it again.");
    }
    const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1];
    if (total) seen.size ??= Number(total);
    return new Uint8Array(await res.arrayBuffer());
  };
  await read(0, 16);
  const bytes = seen.size;
  if (bytes === null) throw new StoredVideoError("The uploaded video couldn't be read.");
  const info = await probeMp4(read, bytes);
  return { bytes, info };
}

/** Removes an upload's files that won't be used (a rejected video). Best effort. */
export async function removeUpload(db: Db, paths: readonly string[]): Promise<void> {
  try {
    const { error } = await db.storage.from(VIDEOS_BUCKET).remove([...paths]);
    if (error) console.error(`Removing the rejected upload failed: ${error.message}`);
  } catch (err) {
    console.error("Removing the rejected upload failed:", err);
  }
}

/**
 * Deletes every uploaded video and thumbnail of a workspace (the Sandbox, when a scenario resets
 * it). Storage can't be emptied with SQL, so this lists each folder and removes what it finds.
 * Best effort: a Storage error leaves the files.
 */
export async function clearWorkspaceUploads(db: Db, workspaceId: string): Promise<void> {
  const bucket = db.storage.from(VIDEOS_BUCKET);
  for (const folder of ["videos", "thumbnails"]) {
    const prefix = `${workspaceId}/${folder}`;
    try {
      for (let round = 0; round < 20; round++) {
        const { data, error } = await bucket.list(prefix, { limit: 1000 });
        if (error) throw new Error(error.message);
        if (data.length === 0) break;
        const removed = await bucket.remove(data.map((f) => `${prefix}/${f.name}`));
        if (removed.error) throw new Error(removed.error.message);
      }
    } catch (err) {
      console.error(`Clearing ${prefix} failed:`, err);
    }
  }
}
