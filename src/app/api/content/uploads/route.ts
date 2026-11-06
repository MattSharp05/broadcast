import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { UPLOAD_TTL_MS, forgetUpload, recordUpload, uploadsSince } from "@/lib/db/content-api";
import { signUploadUrl, uploadPaths } from "@/lib/db/videos";
import { UPLOADS_PER_HOUR, parseUploadRequest, problem } from "@/lib/domain/content-api";
import { checkFile, videoContentType } from "@/lib/media/checks";
import { SERVER_ERROR, authorizedBody, problemResponse } from "../shared";

export const dynamic = "force-dynamic";

/**
 * Content API, step 1 (ADR 0005): a signed URL to PUT one video to, in the API key's workspace.
 * The file goes straight to Storage, never through Vercel. Body: `{ file_name, bytes,
 * content_type? }`. The type and size are checked first; at most UPLOADS_PER_HOUR per key.
 */
export async function POST(request: NextRequest) {
  try {
    const req = await authorizedBody(request);
    if (!req.ok) return req.response;
    const { admin, auth } = req;

    const parsed = parseUploadRequest(req.body);
    if (!parsed.ok) return problemResponse(parsed.problem);
    const file = {
      fileName: parsed.value.fileName,
      mimeType: parsed.value.contentType,
      bytes: parsed.value.bytes,
    };
    const issues = checkFile(file);
    if (issues.length > 0) {
      return problemResponse(problem(422, "invalid_file", issues.map((i) => i.message).join(" ")));
    }

    const now = new Date();
    const recent = await uploadsSince(admin, auth.keyId, new Date(now.getTime() - 3_600_000));
    if (recent >= UPLOADS_PER_HOUR) {
      return problemResponse(
        problem(
          429,
          "rate_limited",
          `This key asked for ${UPLOADS_PER_HOUR} uploads in the last hour. Try again later.`,
        ),
        { "Retry-After": "600" },
      );
    }

    const id = randomUUID();
    const contentType = videoContentType(file);
    const storagePath = uploadPaths(auth.workspaceId, id, contentType).video;
    const expiresAt = new Date(now.getTime() + UPLOAD_TTL_MS);
    await recordUpload(admin, {
      id,
      workspaceId: auth.workspaceId,
      keyId: auth.keyId,
      storagePath,
      fileName: file.fileName,
      contentType,
      expiresAt,
    });
    let uploadUrl: string;
    try {
      uploadUrl = await signUploadUrl(admin, storagePath);
    } catch (err) {
      console.error(err);
      await forgetUpload(admin, auth.workspaceId, id);
      return problemResponse(
        problem(502, "storage_unavailable", "Couldn't start the upload. Try again in a moment."),
      );
    }
    return NextResponse.json(
      {
        upload_id: id,
        upload_url: uploadUrl,
        method: "PUT",
        content_type: contentType,
        expires_at: expiresAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("POST /api/content/uploads failed:", err);
    return problemResponse(SERVER_ERROR);
  }
}
