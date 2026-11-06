"use client";

import { checkFile, checkVideo, type MediaIssue } from "@/lib/media/checks";
import { blobReader, Mp4Error, probeMp4, type Mp4Info } from "@/lib/media/mp4";

/** What the dialog knows about the chosen file after reading it (nothing is uploaded yet). */
export interface ReadVideo {
  file: File;
  info: Mp4Info | null;
  issues: MediaIssue[];
  /** A JPEG frame from 1 s in, or null when this browser can't decode the video. */
  thumbnail: Blob | null;
  /** An object URL for `thumbnail`, for the preview. */
  thumbnailUrl: string | null;
}

/** Thumbnail size: 9:16, plenty for cards (50×88) and drawers. */
const THUMB_W = 360;
const THUMB_H = 640;
const THUMB_AT_S = 1;
const FRAME_TIMEOUT_MS = 8_000;

/**
 * Grabs one frame (1 s in, or the middle of a shorter video) on a canvas. Resolves null when the
 * browser can't play the codec (e.g. HEVC in some browsers): the card then keeps its placeholder.
 */
export function grabFrame(file: Blob, durationS: number | null): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (blob: Blob | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    const timer = setTimeout(() => {
      finish(null);
    }, FRAME_TIMEOUT_MS);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener("error", () => {
      finish(null);
    });
    video.addEventListener("loadedmetadata", () => {
      const length = Number.isFinite(video.duration) ? video.duration : (durationS ?? 0);
      video.currentTime = Math.min(THUMB_AT_S, length / 2);
    });
    video.addEventListener("seeked", () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        finish(null);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = THUMB_W;
      canvas.height = THUMB_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        finish(null);
        return;
      }
      // Cover: fill 9:16, cropping whatever doesn't fit.
      const scale = Math.max(THUMB_W / w, THUMB_H / h);
      const dw = w * scale;
      const dh = h * scale;
      ctx.drawImage(video, (THUMB_W - dw) / 2, (THUMB_H - dh) / 2, dw, dh);
      canvas.toBlob(
        (blob) => {
          finish(blob);
        },
        "image/jpeg",
        0.82,
      );
    });
    video.src = url;
  });
}

/**
 * Reads a chosen file: type and size first, then duration, size and codec from the MP4/MOV
 * index, then a thumbnail frame. Nothing leaves the browser.
 */
export async function readVideo(file: File): Promise<ReadVideo> {
  const facts = { bytes: file.size, mimeType: file.type, fileName: file.name };
  const fileIssues = checkFile(facts);
  if (fileIssues.some((i) => i.code === "type")) {
    return { file, info: null, issues: fileIssues, thumbnail: null, thumbnailUrl: null };
  }
  let info: Mp4Info;
  try {
    info = await probeMp4(blobReader(file), file.size);
  } catch (err) {
    const message =
      err instanceof Mp4Error
        ? `${err.message} Reels must be an MP4 or MOV video.`
        : "This video couldn't be read. Reels must be an MP4 or MOV video.";
    return {
      file,
      info: null,
      issues: [...fileIssues, { code: "type", message }],
      thumbnail: null,
      thumbnailUrl: null,
    };
  }
  const issues = [...fileIssues, ...checkVideo(info)];
  const thumbnail = issues.length === 0 ? await grabFrame(file, info.durationS) : null;
  return {
    file,
    info,
    issues,
    thumbnail,
    thumbnailUrl: thumbnail ? URL.createObjectURL(thumbnail) : null,
  };
}
