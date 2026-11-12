import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db/factory";
import { VIDEOS_BUCKET } from "@/lib/db/videos";

/**
 * Files a Claude session uploads for one video (docs/factory-api.md → /assets). Referenced as
 * `storage:<bucket>/<path>`; the page and the generation proxy turn them into signed URLs. Paths
 * are made here, never taken from the caller, and always start with the workspace id.
 */

export const FACTORY_BUCKET = "factory";
const SIGNED_TTL_S = 60 * 60;

export const ASSET_TYPES: Record<string, { ext: string; bucket: string }> = {
  "image/jpeg": { ext: "jpg", bucket: FACTORY_BUCKET },
  "image/png": { ext: "png", bucket: FACTORY_BUCKET },
  "audio/wav": { ext: "wav", bucket: FACTORY_BUCKET },
  "audio/x-wav": { ext: "wav", bucket: FACTORY_BUCKET },
  "audio/mpeg": { ext: "mp3", bucket: FACTORY_BUCKET },
  // The final render: in the videos bucket, where the scheduler publishes from.
  "video/mp4": { ext: "mp4", bucket: VIDEOS_BUCKET },
};

export interface AssetRef {
  bucket: string;
  path: string;
}

export function assetPath(
  workspaceId: string,
  productionId: string,
  contentType: string,
): AssetRef | null {
  const t = ASSET_TYPES[contentType];
  if (!t) return null;
  const id = randomUUID();
  if (t.bucket === VIDEOS_BUCKET) {
    return {
      bucket: t.bucket,
      path: `${workspaceId}/videos/factory-${productionId.slice(0, 8)}-${id}.mp4`,
    };
  }
  return { bucket: t.bucket, path: `${workspaceId}/${productionId}/${id}.${t.ext}` };
}

export function toRef(a: AssetRef): string {
  return `storage:${a.bucket}/${a.path}`;
}

/** Parses `storage:<bucket>/<path>` when it belongs to the workspace (and production, for assets). */
export function parseRef(ref: string, workspaceId: string, productionId?: string): AssetRef | null {
  const m = /^storage:(factory|videos)\/([A-Za-z0-9/_.-]+)$/.exec(ref);
  if (!m || m[2]?.includes("..")) return null;
  const bucket = m[1] ?? "";
  const path = m[2] ?? "";
  if (!path.startsWith(`${workspaceId}/`)) return null;
  if (
    productionId &&
    bucket === FACTORY_BUCKET &&
    !path.startsWith(`${workspaceId}/${productionId}/`)
  ) {
    return null;
  }
  if (
    productionId &&
    bucket === VIDEOS_BUCKET &&
    !path.includes(`/videos/factory-${productionId.slice(0, 8)}-`)
  ) {
    return null;
  }
  return { bucket, path };
}

export async function signAssetUpload(db: Db, a: AssetRef): Promise<string> {
  const { data, error } = await db.storage.from(a.bucket).createSignedUploadUrl(a.path);
  if (error || !data.signedUrl)
    throw new Error(`Signing the upload failed: ${error?.message ?? "no URL"}`);
  return data.signedUrl;
}

/** A short-lived download URL for a stored asset; anything that isn't a storage ref is returned as is. */
export async function signedUrlFor(db: Db, value: string, workspaceId: string): Promise<string> {
  if (!value.startsWith("storage:")) return value;
  const a = parseRef(value, workspaceId);
  if (!a) return value;
  const { data, error } = await db.storage.from(a.bucket).createSignedUrl(a.path, SIGNED_TTL_S);
  if (error) return value;
  return data.signedUrl;
}

/** Signs every `url` in a checkpoint output's frames/stills (for the page). */
export async function signOutputUrls<T>(db: Db, output: T, workspaceId: string): Promise<T> {
  if (!output || typeof output !== "object") return output;
  const o = { ...(output as Record<string, unknown>) };
  for (const key of ["frames", "stills"]) {
    const items = o[key];
    if (!Array.isArray(items)) continue;
    o[key] = await Promise.all(
      items.map(async (it: unknown) => {
        if (!it || typeof it !== "object") return it;
        const item = it as Record<string, unknown>;
        return typeof item.url === "string"
          ? { ...item, url: await signedUrlFor(db, item.url, workspaceId) }
          : item;
      }),
    );
  }
  return o as T;
}
