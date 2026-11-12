import { NextResponse, type NextRequest } from "next/server";
import { ASSET_TYPES, assetPath, signAssetUpload, toRef } from "@/lib/factory/assets";
import { apiError, errorResponse, factoryRequest } from "../../shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/factory/{id}/assets: `{name, content_type}` → a signed URL to PUT one file to, and the
 * `storage:` path to use in a checkpoint or the generation proxy.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await factoryRequest(request, id, { body: true });
  if (!req.ok) return req.response;
  const type = req.value.body.content_type;
  if (typeof type !== "string" || !ASSET_TYPES[type]) {
    return apiError(
      422,
      "bad_type",
      `content_type must be one of ${Object.keys(ASSET_TYPES).join(", ")}.`,
    );
  }
  try {
    const ref = assetPath(req.value.auth.workspaceId, id, type);
    if (!ref) return apiError(422, "bad_type", "Unsupported content_type.");
    const uploadUrl = await signAssetUpload(req.value.ctx.db, ref);
    return NextResponse.json(
      { path: toRef(ref), upload_url: uploadUrl, method: "PUT", content_type: type },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
