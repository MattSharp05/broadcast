import { NextResponse, type NextRequest } from "next/server";
import { getProduction, getSteps } from "@/lib/db/factory";
import type { Json } from "@/lib/db/types";
import { isStep, nextStep } from "@/lib/domain/factory/steps";
import { recordCheckpoint } from "@/lib/factory/engine";
import { logSessionIntent } from "@/lib/factory/studio";
import { apiError, errorResponse, factoryRequest } from "../../shared";
import { checkProxy, storeRender } from "../../uploads";

export const dynamic = "force-dynamic";

/**
 * POST /api/factory/{id}/checkpoint: `{step, output}`. The step then waits for Matthew, or is
 * approved at once on autopilot. A render's `output.upload` is the MP4 from /assets: checked like
 * any Reel and stored with the video's recipe. Never queued here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await factoryRequest(request, id, { body: true });
  if (!req.ok) return req.response;
  const { ctx } = req.value;
  const { step, output, intent } = req.value.body;
  if (!isStep(step))
    return apiError(
      422,
      "bad_step",
      "step must be one of idea, script, style, visuals, face_quote, render.",
    );
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return apiError(
      422,
      "bad_output",
      "output must be an object (docs/factory-api.md lists each step's fields).",
    );
  }
  try {
    const steps = await getSteps(ctx.db, ctx.workspaceId, id);
    const row = steps.find((s) => s.step === step);
    if (!row) return apiError(409, "no_step", "That step isn't part of this video.");
    if (row.status !== "running" && row.status !== "failed") {
      return apiError(
        409,
        "not_running",
        `The ${step} step is ${row.status}, not running. Only post the step you were started for.`,
      );
    }

    let mediaId: string | null = null;
    if (step === "render") {
      const out = output as Record<string, unknown>;
      if (typeof out.git_sha !== "string" || !out.git_sha.trim()) {
        return apiError(
          422,
          "missing_git_sha",
          "output.git_sha is required: send `git rev-parse HEAD` after committing the film.",
        );
      }
      if (out.proxy !== undefined && out.proxy !== null) {
        const proxyError = await checkProxy(ctx, id, out.proxy);
        if (proxyError) return proxyError;
      }
      const stored = await storeRender(ctx, id, out.upload, "output.upload");
      if (!stored.ok) return stored.response;
      mediaId = stored.value.mediaId;
      if (Array.isArray(out.caption_options)) {
        const opts = out.caption_options
          .filter((c): c is string => typeof c === "string")
          .slice(0, 6);
        if (opts.length)
          await ctx.db
            .from("productions")
            .update({ caption_options: opts })
            .eq("workspace_id", ctx.workspaceId)
            .eq("id", id);
      }
    }
    const said = intent ?? (output as Record<string, unknown>).intent;
    await recordCheckpoint(ctx, id, step, output as Json, { mediaId, intent: said });
    await logSessionIntent(ctx, id, step, said);
    const after = await getSteps(ctx.db, ctx.workspaceId, id);
    const p = await getProduction(ctx.db, ctx.workspaceId, id);
    const status = after.find((s) => s.step === step)?.status;
    return NextResponse.json({
      status: status === "waiting" ? "waiting" : "approved",
      next_step: status === "waiting" ? null : nextStep(step, p.use_avatar),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
