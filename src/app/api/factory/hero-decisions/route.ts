import { NextResponse, type NextRequest } from "next/server";
import { workspaceKindOf } from "@/lib/db/workspaces";
import { decisionsExport } from "@/lib/factory/hero";
import { errorResponse, factoryRequest } from "../shared";

export const dynamic = "force-dynamic";

/** GET /api/factory/hero-decisions: every hero decision of the workspace (the skill learns from it). */
export async function GET(request: NextRequest) {
  const req = await factoryRequest(request, null);
  if (!req.ok) return req.response;
  const { ctx } = req.value;
  try {
    return NextResponse.json(
      await decisionsExport({
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        sandbox: workspaceKindOf(ctx.workspaceId) === "sandbox",
        now: ctx.now,
      }),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
