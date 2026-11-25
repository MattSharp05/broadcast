import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/db/admin";
import { isSignedInOwner } from "@/lib/db/auth";
import { VIDEOS_BUCKET } from "@/lib/db/videos";
import { currentWorkspace } from "@/lib/db/workspace";
import { coverPathFor } from "@/lib/factory/studio";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () =>
  NextResponse.json({ error: "not_found", message: "Unknown video or version." }, { status: 404 });

/**
 * POST /api/factory/{id}/cover `{version_id}` (signed-in owner): a signed upload URL for a
 * version's cover JPEG, in the videos bucket next to the videos (`<ws>/covers/<version id>.jpg`,
 * replaced when picked again). The browser PUTs the frame there; it never gets a service key.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await isSignedInOwner()))
    return NextResponse.json({ error: "unauthorized", message: "Sign in again." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { version_id?: unknown };
  const versionId = typeof body.version_id === "string" ? body.version_id : "";
  if (!UUID.test(id) || !UUID.test(versionId)) return notFound();
  const workspace = await currentWorkspace();
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("production_versions")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("production_id", id)
    .eq("id", versionId)
    .maybeSingle();
  if (!data) return notFound();
  const path = coverPathFor(workspace.id, versionId);
  const signed = await admin.storage
    .from(VIDEOS_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (signed.error)
    return NextResponse.json(
      { error: "server_error", message: "Couldn't prepare the upload. Try again." },
      { status: 500 },
    );
  return NextResponse.json({ path, upload_url: signed.data.signedUrl }, { status: 201 });
}
