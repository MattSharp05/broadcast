import { NextResponse, type NextRequest } from "next/server";
import { workspaceKindOf } from "@/lib/db/workspaces";
import { pollMeshJob } from "@/lib/factory/hero";
import { apiError, errorResponse, factoryRequest } from "../../../factory/shared";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/gen/mesh-jobs/{job_id}: status; the .glb URL points at Broadcast's copy. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!UUID.test(jobId)) return apiError(404, "not_found", "No such job.");
  const req = await factoryRequest(request, null);
  if (!req.ok) return req.response;
  const { ctx, auth } = req.value;
  try {
    const job = await pollMeshJob(
      {
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        sandbox: workspaceKindOf(ctx.workspaceId) === "sandbox",
        now: ctx.now,
      },
      jobId,
      auth.productionId,
    );
    return NextResponse.json({
      job_id: job.id,
      status: job.status,
      output_url: job.output_url,
      outputs: job.outputs ?? null,
      cost_usd: job.cost_usd,
      error: job.error,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
