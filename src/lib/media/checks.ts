/**
 * Instagram Reels format checks (PRD; docs/DESIGN.md → Copy). Pure: the dashboard runs them in the
 * browser before uploading, the server runs them again on what it reads from Storage, and the
 * content API (BC-17) reuses them.
 *
 * What a Reel must be here: an MP4 or MOV file, H.264 or HEVC video, 9:16 (±2%), 3–90 seconds,
 * up to 50 MB and at most 1920 pixels wide (Instagram's limit).
 */

export const REELS = {
  maxBytes: 50 * 1024 * 1024,
  minDurationS: 3,
  maxDurationS: 90,
  /** Width ÷ height. */
  aspect: 9 / 16,
  aspectTolerance: 0.02,
  maxWidth: 1920,
  mimeTypes: ["video/mp4", "video/quicktime", "video/x-m4v"] as readonly string[],
  extensions: ["mp4", "mov", "m4v"] as readonly string[],
  /** MP4 sample entry types Instagram accepts: H.264 and HEVC. */
  codecs: ["avc1", "avc3", "hvc1", "hev1"] as readonly string[],
} as const;

export type MediaIssueCode =
  "type" | "size" | "aspect" | "too_short" | "too_long" | "width" | "codec";

export interface MediaIssue {
  code: MediaIssueCode;
  message: string;
}

export interface FileFacts {
  bytes: number;
  /** The browser's or uploader's MIME type ("" when unknown). */
  mimeType?: string | null;
  fileName?: string | null;
}

export interface VideoFacts {
  width: number;
  height: number;
  durationS: number;
  /** MP4 sample entry type (`avc1`, `hvc1`, …); null when it couldn't be read. */
  codec?: string | null;
}

const MB = 1024 * 1024;

function extension(name: string | null | undefined): string {
  const m = /\.([a-z0-9]+)$/i.exec(name ?? "");
  return m?.[1]?.toLowerCase() ?? "";
}

/** "60 MB", "12.5 MB", "800 KB". */
export function sizeLabel(bytes: number): string {
  if (bytes >= MB) {
    const mb = bytes / MB;
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "95 seconds", "2.5 seconds", "1 second". */
function secondsLabel(s: number): string {
  const rounded = s >= 10 ? Math.round(s) : Math.round(s * 10) / 10;
  return `${rounded} second${rounded === 1 ? "" : "s"}`;
}

const CODEC_NAMES: Record<string, string> = {
  avc1: "H.264",
  avc3: "H.264",
  hvc1: "HEVC",
  hev1: "HEVC",
  vp08: "VP8",
  vp09: "VP9",
  av01: "AV1",
  mp4v: "MPEG-4 Part 2",
  apcn: "ProRes",
  apch: "ProRes",
  apcs: "ProRes",
  apco: "ProRes",
  ap4h: "ProRes",
};

export function codecName(codec: string): string {
  return CODEC_NAMES[codec] ?? codec;
}

/** The video's MIME type for Storage: MOV files are QuickTime, everything else MP4. */
export function videoContentType(file: FileFacts): "video/mp4" | "video/quicktime" {
  return file.mimeType === "video/quicktime" || extension(file.fileName) === "mov"
    ? "video/quicktime"
    : "video/mp4";
}

/** Checks that need only the file itself: type and size (run before reading or uploading it). */
export function checkFile(file: FileFacts): MediaIssue[] {
  const issues: MediaIssue[] = [];
  const mime = (file.mimeType ?? "").toLowerCase();
  const ext = extension(file.fileName);
  const typeOk = mime ? REELS.mimeTypes.includes(mime) : REELS.extensions.includes(ext);
  if (!typeOk) {
    const what = ext ? `a .${ext} file` : mime ? `a ${mime} file` : "not a video";
    issues.push({
      code: "type",
      message: `This file is ${what}. Reels must be an MP4 or MOV video.`,
    });
  }
  if (file.bytes > REELS.maxBytes) {
    issues.push({
      code: "size",
      message: `This video is ${sizeLabel(file.bytes)}. Reels can be up to ${sizeLabel(REELS.maxBytes)}.`,
    });
  }
  return issues;
}

/** True when width ÷ height is within ±2% of 9:16. */
export function isNineBySixteen(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  return Math.abs(width / height / REELS.aspect - 1) <= REELS.aspectTolerance;
}

/** Checks on what's inside the file: aspect ratio, length, width and codec. */
export function checkVideo(video: VideoFacts): MediaIssue[] {
  const issues: MediaIssue[] = [];
  const { width, height, durationS } = video;
  if (!isNineBySixteen(width, height)) {
    issues.push({
      code: "aspect",
      message: `This video is ${width} × ${height}. Reels must be 9:16 (1080 × 1920).`,
    });
  } else if (width > REELS.maxWidth) {
    issues.push({
      code: "width",
      message: `This video is ${width} × ${height}. Reels can be at most ${REELS.maxWidth} pixels wide; 1080 × 1920 is best.`,
    });
  }
  if (!(durationS >= REELS.minDurationS)) {
    issues.push({
      code: "too_short",
      message: `This video is ${secondsLabel(durationS)} long. Reels must be ${REELS.minDurationS} to ${REELS.maxDurationS} seconds.`,
    });
  } else if (durationS > REELS.maxDurationS) {
    issues.push({
      code: "too_long",
      message: `This video is ${secondsLabel(durationS)} long. Reels must be ${REELS.minDurationS} to ${REELS.maxDurationS} seconds.`,
    });
  }
  if (video.codec && !REELS.codecs.includes(video.codec)) {
    issues.push({
      code: "codec",
      message: `This video is encoded as ${codecName(video.codec)}. Reels must be H.264 or HEVC; export it again as H.264 MP4.`,
    });
  }
  return issues;
}

/** Every check at once. An empty list means the video can be posted as a Reel. */
export function checkReel(file: FileFacts, video: VideoFacts): MediaIssue[] {
  return [...checkFile(file), ...checkVideo(video)];
}
