import { parseNowParam } from "@/lib/clock";
import { MAX_CAPTION_LENGTH, localInputToUtc, type ContentTiming } from "./content";

/**
 * The content API's request bodies (BC-17, ADR 0005; docs/content-api.md): checked and turned
 * into what the handlers need. Pure. Errors carry the HTTP status, a stable `error` code and a
 * message for the person (or agent) that sent the request.
 */

export interface ApiProblem {
  status: number;
  error: string;
  message: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: ApiProblem };

/** Largest JSON body either endpoint reads (a caption is at most 2,200 characters). */
export const MAX_BODY_BYTES = 16 * 1024;
/** Accounts one request may queue to. */
export const MAX_ACCOUNTS = 20;
/** Upload URLs one key may ask for per hour. */
export const UPLOADS_PER_HOUR = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE = /^[a-z0-9._]{1,30}$/;

export function problem(status: number, error: string, message: string): ApiProblem {
  return { status, error, message };
}

const bad = (message: string): { ok: false; problem: ApiProblem } => ({
  ok: false,
  problem: problem(400, "invalid_request", message),
});

export const UNAUTHORIZED = problem(
  401,
  "unauthorized",
  "Send a valid API key as `Authorization: Bearer <key>`. Keys are made on /dev/api-keys.",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a JSON body that is at most MAX_BODY_BYTES long. */
export function parseJsonBody(text: string): Parsed<Record<string, unknown>> {
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return { ok: false, problem: problem(413, "too_large", "The request body is too large.") };
  }
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body)) return { ok: true, value: body };
  } catch {
    // fall through
  }
  return bad("Send a JSON object.");
}

export interface UploadRequest {
  fileName: string;
  contentType: string;
  bytes: number;
}

/** `POST /api/content/uploads`: `{ file_name, bytes, content_type? }`. */
export function parseUploadRequest(body: Record<string, unknown>): Parsed<UploadRequest> {
  const fileName = typeof body.file_name === "string" ? body.file_name.trim() : "";
  const bytes = body.bytes;
  if (!fileName || fileName.length > 255) {
    return bad('Send the file\'s name as `file_name`, e.g. "render.mp4".');
  }
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    return bad("Send the file's size in bytes as `bytes`.");
  }
  if (body.content_type !== undefined && typeof body.content_type !== "string") {
    return bad('`content_type` must be a string such as "video/mp4".');
  }
  return {
    ok: true,
    value: { fileName, contentType: body.content_type ?? "", bytes },
  };
}

/** An account named in a request: by id, or by handle (without the @, lower case). */
export type AccountRef = { kind: "id"; id: string } | { kind: "handle"; handle: string };

export interface ContentRequest {
  uploadId: string;
  caption: string;
  accounts: AccountRef[];
  timing: ContentTiming;
}

/** "trip.app", "@Trip.App" or an account id. Null when it's neither. */
export function accountRef(value: string): AccountRef | null {
  const text = value.trim();
  if (UUID.test(text)) return { kind: "id", id: text.toLowerCase() };
  const handle = text.replace(/^@/, "").toLowerCase();
  return HANDLE.test(handle) ? { kind: "handle", handle } : null;
}

/**
 * A pinned time: an ISO date-time with a zone (`2026-11-08T12:00:00Z`), or a local
 * `2026-11-08T12:00` read in the workspace timezone (the dashboard's rule).
 */
export function pinnedAt(value: string, timezone: string): Date | null {
  return parseNowParam(value) ?? localInputToUtc(value, timezone);
}

/** `POST /api/content`: `{ upload_id, caption, accounts, timing }`. */
export function parseContentRequest(
  body: Record<string, unknown>,
  timezone: string,
): Parsed<ContentRequest> {
  const uploadId = body.upload_id;
  if (typeof uploadId !== "string" || !UUID.test(uploadId)) {
    return bad("Send the `upload_id` that POST /api/content/uploads returned.");
  }
  const caption = body.caption ?? "";
  if (typeof caption !== "string") return bad("`caption` must be a string.");
  if (caption.length > MAX_CAPTION_LENGTH) {
    return {
      ok: false,
      problem: problem(
        422,
        "caption_too_long",
        `The caption is ${caption.length} characters. Instagram allows ${MAX_CAPTION_LENGTH}.`,
      ),
    };
  }
  const list = body.accounts;
  if (!Array.isArray(list) || list.length === 0) {
    return bad('Choose at least one account to post to: `accounts: ["handle"]`.');
  }
  if (list.length > MAX_ACCOUNTS) return bad(`Send at most ${MAX_ACCOUNTS} accounts at once.`);
  const accounts: AccountRef[] = [];
  for (const item of list) {
    const ref = typeof item === "string" ? accountRef(item) : null;
    if (!ref) {
      return bad(`${JSON.stringify(item)} isn't an account handle or id.`);
    }
    accounts.push(ref);
  }

  const rawTiming = body.timing ?? "next_slot";
  let timing: ContentTiming;
  if (rawTiming === "next_slot") {
    timing = { kind: "queue" };
  } else if (isRecord(rawTiming) && typeof rawTiming.pinned_at === "string") {
    const at = pinnedAt(rawTiming.pinned_at, timezone);
    if (!at) {
      return bad(
        '`pinned_at` must be a date and time like "2026-11-08T12:00" (workspace time) or "2026-11-08T12:00:00Z".',
      );
    }
    timing = { kind: "pinned", at };
  } else {
    return bad('`timing` must be "next_slot" or `{ "pinned_at": "2026-11-08T12:00" }`.');
  }

  return {
    ok: true,
    value: { uploadId: uploadId.toLowerCase(), caption: caption.trim(), accounts, timing },
  };
}

/** How an account reference reads in a message: "@trip.app" or the id. */
export function refLabel(ref: AccountRef): string {
  return ref.kind === "handle" ? `@${ref.handle}` : ref.id;
}
