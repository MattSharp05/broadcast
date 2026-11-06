import { NextResponse, type NextRequest } from "next/server";
import { nowFor } from "@/lib/clock";
import { claimUpload, releaseUpload, resolveAccounts } from "@/lib/db/content-api";
import { ContentError, queueContent } from "@/lib/db/posts";
import { StoredVideoError, probeStoredVideo, removeUnusedUpload } from "@/lib/db/videos";
import { loadWorkspace } from "@/lib/db/workspace";
import { addedMessage, firstTime } from "@/lib/domain/content";
import { parseContentRequest, problem, refLabel } from "@/lib/domain/content-api";
import { checkReel } from "@/lib/media/checks";
import { Mp4Error } from "@/lib/media/mp4";
import { SERVER_ERROR, authorizedBody, problemResponse } from "./shared";

export const dynamic = "force-dynamic";

const CLAIM_PROBLEMS = {
  not_found: problem(
    404,
    "upload_not_found",
    "That upload_id isn't known in this key's workspace. Ask POST /api/content/uploads for one.",
  ),
  used: problem(409, "upload_used", "That upload has already been queued. Upload the video again."),
  expired: problem(410, "upload_expired", "That upload has expired. Upload the video again."),
} as const;

/**
 * Content API, step 3 (ADR 0005): queues an uploaded video on the key's accounts, exactly as the
 * dashboard's Add content does (the same checks of the stored file, the same `queueContent`).
 * It only queues: the scheduler publishes later. Body: `{ upload_id, caption, accounts,
 * timing }` (docs/content-api.md). Returns each post's `scheduled_at`.
 */
export async function POST(request: NextRequest) {
  let claimed: { admin: Parameters<typeof releaseUpload>[0]; ws: string; id: string } | null = null;
  try {
    const req = await authorizedBody(request);
    if (!req.ok) return req.response;
    const { admin, auth } = req;
    const ws = auth.workspaceId;

    const workspace = await loadWorkspace(admin, auth.kind);
    const timezone = workspace.timezone ?? "UTC";
    const now = nowFor(workspace);

    const parsed = parseContentRequest(req.body, timezone);
    if (!parsed.ok) return problemResponse(parsed.problem);
    const input = parsed.value;

    const accounts = await resolveAccounts(admin, ws, input.accounts);
    if (!accounts.ok) {
      if (accounts.elsewhere.length > 0) {
        const other = auth.kind === "sandbox" ? "Live" : "Sandbox";
        return problemResponse(
          problem(
            403,
            "wrong_workspace",
            `${accounts.elsewhere.map(refLabel).join(", ")} is in the ${other} workspace. This key can only queue to ${auth.kind === "sandbox" ? "Sandbox" : "Live"} accounts.`,
          ),
        );
      }
      return problemResponse(
        problem(
          422,
          "unknown_account",
          `No account ${accounts.missing.map(refLabel).join(", ")} in this workspace.`,
        ),
      );
    }

    const claim = await claimUpload(admin, ws, input.uploadId);
    if (!claim.ok) return problemResponse(CLAIM_PROBLEMS[claim.reason]);
    claimed = { admin, ws, id: claim.upload.id };
    const { upload } = claim;

    // The server's own read of the file (headers and moov only), then BC-14's Reels checks.
    let stored;
    try {
      stored = await probeStoredVideo(admin, upload.storagePath);
    } catch (err) {
      if (err instanceof StoredVideoError) {
        // Most likely the PUT hasn't finished: the client may try again with the same upload.
        return problemResponse(
          problem(
            409,
            "upload_missing",
            "The video hasn't arrived in storage yet. PUT the file to upload_url first.",
          ),
        );
      }
      if (err instanceof Mp4Error) {
        claimed = null; // rejected for good: the file goes, the upload stays used
        await removeUnusedUpload(admin, ws, [upload.storagePath]);
        return problemResponse(
          problem(422, "invalid_video", `${err.message} Reels must be an MP4 or MOV video.`),
        );
      }
      throw err;
    }
    const issues = checkReel(
      { bytes: stored.bytes, fileName: upload.fileName, mimeType: upload.contentType },
      stored.info,
    );
    if (issues.length > 0) {
      claimed = null;
      await removeUnusedUpload(admin, ws, [upload.storagePath]);
      return problemResponse(problem(422, "invalid_video", issues.map((i) => i.message).join(" ")));
    }

    const queued = await queueContent(admin, {
      workspaceId: ws,
      timezone,
      now,
      media: {
        storagePath: upload.storagePath,
        thumbnailPath: null,
        durationS: Math.round(stored.info.durationS * 1000) / 1000,
        width: stored.info.width,
        height: stored.info.height,
        bytes: stored.bytes,
      },
      caption: input.caption,
      accountIds: accounts.accountIds,
      timing: input.timing,
    });
    claimed = null;
    return NextResponse.json(
      {
        media_id: queued.mediaId,
        message: addedMessage(
          queued.posts.length,
          firstTime(queued.posts.map((p) => p.scheduledAt)),
          now,
          timezone,
        ),
        posts: queued.posts.map((p) => ({
          id: p.id,
          account_id: p.accountId,
          handle: p.handle,
          status: p.status,
          scheduled_at: p.scheduledAt?.toISOString() ?? null,
        })),
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ContentError) {
      return problemResponse(problem(422, err.code, err.message));
    }
    console.error("POST /api/content failed:", err);
    return problemResponse(SERVER_ERROR);
  } finally {
    // Still set: the request failed in a way the client can fix (a missing file, a bad caption or
    // a server error), so the upload is given back for another try.
    if (claimed) await releaseUpload(claimed.admin, claimed.ws, claimed.id);
  }
}
