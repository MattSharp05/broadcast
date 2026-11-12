import { NextResponse, type NextRequest } from "next/server";
import { workspaceKindOf } from "@/lib/db/workspaces";
import { jobJson, pollFaceJob } from "@/lib/factory/gen";
import { apiError, errorResponse, factoryRequest } from "../../../factory/shared";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/gen/face-jobs/{job_id}: the job's status (polls the provider once if in flight). */
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
    const job = await pollFaceJob(
      {
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        sandbox: workspaceKindOf(ctx.workspaceId) === "sandbox",
        now: ctx.now,
      },
      jobId,
      auth.productionId,
    );
    return NextResponse.json(jobJson(job));
  } catch (err) {
    return errorResponse(err);
  }
}
