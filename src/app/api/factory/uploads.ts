import "server-only";
import type { NextResponse } from "next/server";
import { insertMedia } from "@/lib/db/posts";
import { StoredVideoError, VIDEOS_BUCKET, probeStoredVideo } from "@/lib/db/videos";
import type { Mp4Info } from "@/lib/media/mp4";
import { Mp4Error } from "@/lib/media/mp4";
import { checkReel } from "@/lib/media/checks";
import { parseRef } from "@/lib/factory/assets";
import type { EngineContext } from "@/lib/factory/engine";
import { apiError } from "./shared";

/** A 720p draft proxy: an MP4 from /assets, at most 15 MB (docs/factory-api.md). */
export const PROXY_MAX_BYTES = 15 * 1024 * 1024;

type Checked<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

async function probe(
  ctx: EngineContext,
  path: string,
  what: string,
): Promise<Checked<{ bytes: number; info: Mp4Info }>> {
  try {
    return { ok: true, value: await probeStoredVideo(ctx.db, path) };
  } catch (err) {
    if (err instanceof StoredVideoError)
      return {
        ok: false,
        response: apiError(
          409,
          "upload_missing",
          `The ${what} hasn't arrived in storage yet. PUT it to the upload_url first.`,
        ),
      };
    if (err instanceof Mp4Error)
      return {
        ok: false,
        response: apiError(422, "invalid_video", `${err.message} The ${what} must be an MP4.`),
      };
    throw err;
  }
}

/**
 * The full render a session uploaded: checked like any Reel (9:16, MP4, ≤ 50 MB) and stored as a
 * media asset. Returns the media id and the facts read from the file.
 */
export async function storeRender(
  ctx: EngineContext,
  productionId: string,
  upload: unknown,
  field = "upload",
): Promise<Checked<{ mediaId: string; bytes: number; info: Mp4Info }>> {
  const ref = typeof upload === "string" ? parseRef(upload, ctx.workspaceId, productionId) : null;
  if (ref?.bucket !== VIDEOS_BUCKET) {
    return {
      ok: false,
      response: apiError(
        422,
        "bad_upload",
        `${field} must be the storage: path of an MP4 from /assets.`,
      ),
    };
  }
  const stored = await probe(ctx, ref.path, "render");
  if (!stored.ok) return stored;
  const { bytes, info } = stored.value;
  const issues = checkReel({ bytes, fileName: "render.mp4", mimeType: "video/mp4" }, info);
  if (issues.length)
    return {
      ok: false,
      response: apiError(422, "invalid_video", issues.map((i) => i.message).join(" ")),
    };
  const mediaId = await insertMedia(ctx.db, ctx.workspaceId, {
    storagePath: ref.path,
    thumbnailPath: null,
    durationS: Math.round(info.durationS * 1000) / 1000,
    width: info.width,
    height: info.height,
    bytes,
  });
  return { ok: true, value: { mediaId, bytes, info } };
}

/** A proxy from /assets: an MP4 of at most 15 MB. Returns the refusal, or null when it's fine. */
export async function checkProxy(
  ctx: EngineContext,
  productionId: string,
  proxy: unknown,
): Promise<NextResponse | null> {
  const ref = typeof proxy === "string" ? parseRef(proxy, ctx.workspaceId, productionId) : null;
  if (ref?.bucket !== VIDEOS_BUCKET) {
    return apiError(422, "bad_proxy", "proxy must be the storage: path of an MP4 from /assets.");
  }
  const stored = await probe(ctx, ref.path, "proxy");
  if (!stored.ok) return stored.response;
  if (stored.value.bytes > PROXY_MAX_BYTES) {
    return apiError(
      422,
      "proxy_too_large",
      "The proxy is over 15 MB. Make it with ffmpeg -vf scale=720:-2 -b:v 1.5M.",
    );
  }
  return null;
}
