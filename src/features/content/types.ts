/** Shapes shared by the Add content dialog and the server code it calls (BC-14). */

export type ActionResult<T = null> = { ok: true; value: T } | { ok: false; error: string };

/** What POST /api/uploads returns: where to PUT the video and its thumbnail. */
export interface UploadTicket {
  uploadId: string;
  contentType: "video/mp4" | "video/quicktime";
  video: { path: string; uploadUrl: string };
  thumbnail: { path: string; uploadUrl: string };
}

export interface AddContentInput {
  fileName: string;
  videoPath: string;
  /** null when the browser couldn't grab a frame (the card shows the placeholder). */
  thumbnailPath: string | null;
  caption: string;
  accountIds: string[];
  /** `local` is a `datetime-local` value in the workspace timezone. */
  timing: { kind: "queue" } | { kind: "pinned"; local: string };
}

export interface AddedContent {
  /** The toast: "Added to 2 queues. First post Tomorrow, 13:00." */
  message: string;
  postIds: string[];
}

export type { ContentAccount } from "@/lib/domain/content";
