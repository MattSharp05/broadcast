import { NextResponse, type NextRequest } from "next/server";
import { failPlanning } from "@/lib/routines/planner";
import { errorResponse } from "../../../factory/shared";
import { routineRequest } from "../../shared";

export const dynamic = "force-dynamic";

/** POST /api/routines/{id}/fail `{message}`: the planner gave up; the routine goes back to draft. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await routineRequest(request, id, { body: true });
  if (!req.ok) return req.response;
  const message = typeof req.body.message === "string" ? req.body.message : "No reason given.";
  try {
    await failPlanning(req.ctx, id, message);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
