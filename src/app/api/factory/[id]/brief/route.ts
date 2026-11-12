import { NextResponse, type NextRequest } from "next/server";
import { buildBrief } from "@/lib/factory/brief";
import { errorResponse, factoryRequest } from "../../shared";

export const dynamic = "force-dynamic";

/** GET /api/factory/{id}/brief: the video, the step, earlier outputs, kept clips, the budget. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await factoryRequest(request, id);
  if (!req.ok) return req.response;
  try {
    return NextResponse.json(await buildBrief(req.value.ctx, id));
  } catch (err) {
    return errorResponse(err);
  }
}
