"use client";

import type { UploadTicket } from "./types";

/**
 * PUTs a file straight to a Storage signed upload URL (ADR 0005), reporting progress (0–1).
 * XMLHttpRequest because fetch has no upload progress.
 */
export function putFile(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status}).`));
      }
    });
    xhr.addEventListener("error", () => {
      reject(new Error("Upload failed: network error."));
    });
    xhr.addEventListener("abort", () => {
      reject(new DOMException("Upload cancelled.", "AbortError"));
    });
    signal?.addEventListener("abort", () => {
      xhr.abort();
    });
    xhr.send(body);
  });
}

/** Asks POST /api/uploads for signed upload URLs for one video and its thumbnail (ADR 0005). */
export async function requestUploadTicket(file: File): Promise<UploadTicket> {
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, bytes: file.size }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<UploadTicket> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Couldn't start the upload. Try again.");
  return body as UploadTicket;
}
