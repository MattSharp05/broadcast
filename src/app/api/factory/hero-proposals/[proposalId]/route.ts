import { NextResponse, type NextRequest } from "next/server";
import { workspaceKindOf } from "@/lib/db/workspaces";
import { proposalStatus } from "@/lib/factory/hero";
import { errorResponse, factoryRequest } from "../../shared";

export const dynamic = "force-dynamic";

/** GET /api/factory/hero-proposals/{proposal_id}: pending, or Matthew's decision. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  const { proposalId } = await params;
  const req = await factoryRequest(request, null);
  if (!req.ok) return req.response;
  const { ctx, auth } = req.value;
  try {
    return NextResponse.json(
      await proposalStatus(
        {
          db: ctx.db,
          workspaceId: ctx.workspaceId,
          sandbox: workspaceKindOf(ctx.workspaceId) === "sandbox",
          now: ctx.now,
        },
        decodeURIComponent(proposalId),
        auth.productionId,
      ),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
