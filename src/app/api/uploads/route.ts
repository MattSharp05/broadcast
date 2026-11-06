import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { UploadTicket } from "@/features/content/types";
import { isSignedInOwner } from "@/lib/db/auth";
import { createServerSupabase } from "@/lib/db/server";
import { signUploadUrl, uploadPaths } from "@/lib/db/videos";
import { currentWorkspaceKind } from "@/lib/db/workspace";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { checkFile, videoContentType } from "@/lib/media/checks";

export const dynamic = "force-dynamic";

/**
 * Add content, step 1 (ADR 0005): signed upload URLs for one video and its thumbnail, in the
 * workspace the dashboard shows. The browser PUTs the files straight to Storage, so no video
 * passes through Vercel. Signed-in owner only; the file's type and size are checked first.
 *
 * Body: `{ fileName, contentType, bytes }`.
 */
export async function POST(request: NextRequest) {
  if (!(await isSignedInOwner())) {
    return NextResponse.json({ error: "Sign in to upload videos." }, { status: 401 });
  }
  let body: { fileName?: unknown; contentType?: unknown; bytes?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Send the file's name, type and size." }, { status: 400 });
  }
  const file = {
    fileName: typeof body.fileName === "string" ? body.fileName : "",
    mimeType: typeof body.contentType === "string" ? body.contentType : "",
    bytes: typeof body.bytes === "number" && Number.isFinite(body.bytes) ? body.bytes : -1,
  };
  if (file.bytes <= 0) {
    return NextResponse.json({ error: "Send the file's name, type and size." }, { status: 400 });
  }
  const issues = checkFile(file);
  if (issues.length > 0) {
    return NextResponse.json({ error: issues.map((i) => i.message).join(" ") }, { status: 422 });
  }

  const workspaceId = WORKSPACE_IDS[await currentWorkspaceKind()];
  const uploadId = randomUUID();
  const contentType = videoContentType(file);
  const paths = uploadPaths(workspaceId, uploadId, contentType);
  try {
    const db = await createServerSupabase();
    const [video, thumbnail] = await Promise.all([
      signUploadUrl(db, paths.video),
      signUploadUrl(db, paths.thumbnail),
    ]);
    const ticket: UploadTicket = {
      uploadId,
      contentType,
      video: { path: paths.video, uploadUrl: video },
      thumbnail: { path: paths.thumbnail, uploadUrl: thumbnail },
    };
    return NextResponse.json(ticket);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Couldn't start the upload. Try again in a moment." },
      { status: 502 },
    );
  }
}
