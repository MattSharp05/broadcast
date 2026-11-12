import { NextResponse, type NextRequest } from "next/server";
import { workspaceKindOf } from "@/lib/db/workspaces";
import { submitMeshJob } from "@/lib/factory/hero";
import { apiError, errorResponse, factoryRequest } from "../../factory/shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/gen/mesh-jobs: a 3D model through Broadcast's fal key, only after Matthew approved
 * `generate` for this proposal and model (403 not_approved), under the caps (402 budget). The
 * fal input is rebuilt from the registry; the client's quote is advisory.
 */
export async function POST(request: NextRequest) {
  const req = await factoryRequest(request, null, { body: true });
  if (!req.ok) return req.response;
  const { ctx, auth, body } = req.value;
  const s = (k: string): string | null => {
    const v = body[k];
    return typeof v === "string" && v ? v : null;
  };
  if (body.video_id !== auth.productionId)
    return apiError(403, "wrong_video", "video_id must be the video this token was made for.");
  const proposalId = s("proposal_id");
  const model = s("model");
  const key = s("idempotency_key");
  if (!proposalId || !model || !key)
    return apiError(422, "bad_request", "proposal_id, model and idempotency_key are required.");
  const options = body.options;
  try {
    const { job, reused } = await submitMeshJob(
      {
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        sandbox: workspaceKindOf(ctx.workspaceId) === "sandbox",
        now: ctx.now,
      },
      {
        productionId: auth.productionId,
        proposalId,
        model,
        idempotencyKey: key.slice(0, 200),
        mode: body.mode === "text" ? "text" : "image",
        image: s("image"),
        prompt: s("prompt"),
        seed: typeof body.seed === "number" ? body.seed : null,
        options:
          Array.isArray(options) || (options && typeof options === "object")
            ? (options as Record<string, unknown>)
            : null,
      },
    );
    return NextResponse.json({
      job_id: job.id,
      status: job.status,
      quote_usd: job.quote_usd,
      ...(reused ? { reused: "same_key" } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
