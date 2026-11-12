import { NextResponse, type NextRequest } from "next/server";
import { getProduction, getSteps } from "@/lib/db/factory";
import { insertMedia } from "@/lib/db/posts";
import type { Json } from "@/lib/db/types";
import { StoredVideoError, VIDEOS_BUCKET, probeStoredVideo } from "@/lib/db/videos";
import { isStep, nextStep } from "@/lib/domain/factory/steps";
import { parseRef } from "@/lib/factory/assets";
import { recordCheckpoint } from "@/lib/factory/engine";
import { checkReel } from "@/lib/media/checks";
import { Mp4Error } from "@/lib/media/mp4";
import { apiError, errorResponse, factoryRequest } from "../../shared";

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
  const { ctx, auth } = req.value;
  const { step, output } = req.value.body;
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
      const ref =
        typeof out.upload === "string" ? parseRef(out.upload, auth.workspaceId, id) : null;
      if (ref?.bucket !== VIDEOS_BUCKET) {
        return apiError(
          422,
          "bad_upload",
          "output.upload must be the storage: path of an MP4 from /assets.",
        );
      }
      let stored;
      try {
        stored = await probeStoredVideo(ctx.db, ref.path);
      } catch (err) {
        if (err instanceof StoredVideoError)
          return apiError(
            409,
            "upload_missing",
            "The render hasn't arrived in storage yet. PUT it to the upload_url first.",
          );
        if (err instanceof Mp4Error)
          return apiError(422, "invalid_video", `${err.message} The render must be an MP4.`);
        throw err;
      }
      const issues = checkReel(
        { bytes: stored.bytes, fileName: "render.mp4", mimeType: "video/mp4" },
        stored.info,
      );
      if (issues.length)
        return apiError(422, "invalid_video", issues.map((i) => i.message).join(" "));
      mediaId = await insertMedia(ctx.db, ctx.workspaceId, {
        storagePath: ref.path,
        thumbnailPath: null,
        durationS: Math.round(stored.info.durationS * 1000) / 1000,
        width: stored.info.width,
        height: stored.info.height,
        bytes: stored.bytes,
      });
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
    await recordCheckpoint(ctx, id, step, output as Json, { mediaId });
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
