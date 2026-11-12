import { type NextRequest } from "next/server";
import { isStep } from "@/lib/domain/factory/steps";
import { recordProgress } from "@/lib/factory/engine";
import { apiError, errorResponse, factoryRequest } from "../../shared";

export const dynamic = "force-dynamic";

/** POST /api/factory/{id}/progress: `{step, progress, message}` → 204. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await factoryRequest(request, id, { body: true });
  if (!req.ok) return req.response;
  const { step, progress, message } = req.value.body;
  if (!isStep(step))
    return apiError(
      422,
      "bad_step",
      "step must be one of idea, script, style, visuals, face_quote, render.",
    );
  if (typeof progress !== "number" || !Number.isFinite(progress))
    return apiError(422, "bad_progress", "progress is a number from 0 to 100.");
  try {
    await recordProgress(
      req.value.ctx,
      id,
      step,
      progress,
      typeof message === "string" ? message.slice(0, 300) : null,
    );
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
