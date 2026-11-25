import { NextResponse, type NextRequest } from "next/server";
import { plannerBrief } from "@/lib/routines/planner";
import { errorResponse } from "../../../factory/shared";
import { routineRequest } from "../../shared";

export const dynamic = "force-dynamic";

/** GET /api/routines/{id}/brief: the routine, its slots, what is allowed and every past idea. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await routineRequest(request, id);
  if (!req.ok) return req.response;
  try {
    return NextResponse.json(await plannerBrief(req.ctx, id));
  } catch (err) {
    return errorResponse(err);
  }
}
