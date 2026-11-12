import { NextResponse, type NextRequest } from "next/server";
import { workspaceKindOf } from "@/lib/db/workspaces";
import { signedUrlFor } from "@/lib/factory/assets";
import { jobJson, submitFaceJob } from "@/lib/factory/gen";
import { apiError, errorResponse, factoryRequest } from "../../factory/shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/gen/face-jobs (avatar-studio hand-off; docs/factory-api.md): a paid face clip through
 * Broadcast's provider key, under the caps. Never charges twice for one idempotency key; a slot's
 * kept clip is returned unless Matthew asked to redo that slot.
 */
export async function POST(request: NextRequest) {
  const req = await factoryRequest(request, null, { body: true });
  if (!req.ok) return req.response;
  const { ctx, auth, body } = req.value;
  const s = (k: string): string | null => {
    const v = body[k];
    return typeof v === "string" ? v : null;
  };
  const videoId = s("video_id");
  if (videoId !== auth.productionId) {
    return apiError(
      403,
      "wrong_video",
      "video_id must be the video this token was made for (BROADCAST_VIDEO_ID).",
    );
  }
  const slot = s("slot");
  const model = s("model");
  const key = s("idempotency_key");
  const image = s("image");
  const audio = s("audio");
  const seconds = typeof body.seconds === "number" ? body.seconds : NaN;
  if (!slot || !/^[A-Za-z0-9_-]{1,40}$/.test(slot))
    return apiError(422, "bad_slot", "slot is a name like hook or cta.");
  if (!model) return apiError(422, "bad_model", "model is a key from /api/gen/models.");
  if (!key || key.length > 200)
    return apiError(422, "bad_key", "idempotency_key is required (at most 200 characters).");
  if (!image || !audio)
    return apiError(
      422,
      "bad_input",
      "image and audio are required (data URI, URL or storage: path).",
    );
  try {
    const result = await submitFaceJob(
      {
        db: ctx.db,
        workspaceId: ctx.workspaceId,
        sandbox: workspaceKindOf(ctx.workspaceId) === "sandbox",
        now: ctx.now,
      },
      {
        productionId: auth.productionId,
        slot,
        model,
        idempotencyKey: key,
        image: await signedUrlFor(ctx.db, image, ctx.workspaceId),
        audio: await signedUrlFor(ctx.db, audio, ctx.workspaceId),
        prompt: s("prompt"),
        seed: typeof body.seed === "number" ? body.seed : null,
        seconds,
      },
    );
    return NextResponse.json({
      ...jobJson(result.job),
      ...(result.reused ? { reused: result.reason } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
