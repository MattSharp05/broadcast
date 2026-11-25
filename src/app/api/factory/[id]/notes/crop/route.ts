import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/db/admin";
import { isSignedInOwner } from "@/lib/db/auth";
import { getProduction } from "@/lib/db/factory";
import { currentWorkspace } from "@/lib/db/workspace";
import { FACTORY_BUCKET, signAssetUpload, toRef } from "@/lib/factory/assets";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/factory/{id}/notes/crop (signed-in owner): a signed upload URL for the JPEG of the frame
 * a note points at, in the `factory` bucket under the video. The browser PUTs the file there and
 * saves the returned `path` with the note; it never gets a service key.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await isSignedInOwner()))
    return NextResponse.json({ error: "unauthorized", message: "Sign in again." }, { status: 401 });
  if (!UUID.test(id))
    return NextResponse.json({ error: "not_found", message: "Unknown video." }, { status: 404 });
  const workspace = await currentWorkspace();
  const admin = createAdminSupabase();
  try {
    await getProduction(admin, workspace.id, id);
  } catch {
    return NextResponse.json({ error: "not_found", message: "Unknown video." }, { status: 404 });
  }
  const ref = { bucket: FACTORY_BUCKET, path: `${workspace.id}/${id}/notes/${randomUUID()}.jpg` };
  const uploadUrl = await signAssetUpload(admin, ref);
  return NextResponse.json({ path: toRef(ref), upload_url: uploadUrl }, { status: 201 });
}
