import { NextResponse, type NextRequest } from "next/server";
import { workspaceKindOf } from "@/lib/db/workspaces";
import { upsertProposal } from "@/lib/factory/hero";
import { apiError, errorResponse, factoryRequest } from "../shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/factory/hero-proposals: a hero 3D asset proposal (stage "proposal"), or the generated
 * stills to compare (stage "comparison"). Idempotent on proposal_id + stage.
 */
export async function POST(request: NextRequest) {
  const req = await factoryRequest(request, null, { body: true });
  if (!req.ok) return req.response;
  const { ctx, auth, body } = req.value;
  if (body.video_id !== auth.productionId) {
    return apiError(403, "wrong_video", "video_id must be the video this token was made for.");
  }
  try {
    const out = await upsertProposal(
      {
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        sandbox: workspaceKindOf(ctx.workspaceId) === "sandbox",
        now: ctx.now,
      },
      auth.productionId,
      body,
    );
    return NextResponse.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
