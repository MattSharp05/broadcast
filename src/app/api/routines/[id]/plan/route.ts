import { NextResponse, type NextRequest } from "next/server";
import { parseBrief } from "@/lib/domain/routines";
import { savePlan } from "@/lib/routines/planner";
import { apiError, errorResponse } from "../../../factory/shared";
import { routineRequest } from "../../shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/routines/{id}/plan `{slots: [{slot_id, title, idea, genre, hook, style, voice_key,
 * music_key, notes}]}`: one brief per slot. Checked as a whole (every slot, allowed keys, no
 * repeated idea); any problem → 422 with every issue and nothing saved.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await routineRequest(request, id, { body: true });
  if (!req.ok) return req.response;
  const slots = req.body.slots;
  if (!Array.isArray(slots))
    return apiError(422, "bad_plan", "slots must be a list with one brief per slot of the brief.");
  const plan = slots.map((s) => ({
    slotId:
      s && typeof s === "object" && typeof (s as { slot_id?: unknown }).slot_id === "string"
        ? (s as { slot_id: string }).slot_id
        : "",
    brief: parseBrief(s),
  }));
  try {
    const issues = await savePlan(req.ctx, id, plan);
    if (issues.length)
      return NextResponse.json(
        {
          error: "plan_issues",
          message: "Fix these and post the whole plan again. Nothing was saved.",
          issues: issues.map((i) => ({ slot_id: i.slotId, message: i.message })),
        },
        { status: 422 },
      );
    return NextResponse.json({ status: "planned", slots: plan.length });
  } catch (err) {
    return errorResponse(err);
  }
}
