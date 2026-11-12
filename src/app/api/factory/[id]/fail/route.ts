import { type NextRequest } from "next/server";
import { isStep } from "@/lib/domain/factory/steps";
import { failStep } from "@/lib/factory/engine";
import { apiError, errorResponse, factoryRequest } from "../../shared";

export const dynamic = "force-dynamic";

/** POST /api/factory/{id}/fail: `{step, message}` → 204. The page shows it with a Redo button. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await factoryRequest(request, id, { body: true });
  if (!req.ok) return req.response;
  const { step, message } = req.value.body;
  if (!isStep(step))
    return apiError(
      422,
      "bad_step",
      "step must be one of idea, script, style, visuals, face_quote, render.",
    );
  if (typeof message !== "string" || !message.trim())
    return apiError(422, "bad_message", "Say what went wrong in message.");
  try {
    await failStep(req.value.ctx, id, step, message.trim());
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
