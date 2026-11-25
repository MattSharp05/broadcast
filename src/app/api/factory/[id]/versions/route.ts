import { NextResponse, type NextRequest } from "next/server";
import { FactoryError } from "@/lib/db/factory";
import type { NoteAnswer } from "@/lib/domain/factory/notes";
import { applyRevision, prepareRevision } from "@/lib/factory/studio";
import { apiError, errorResponse, factoryRequest } from "../../shared";
import { checkProxy, storeRender } from "../../uploads";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  wrong_batch: 403,
  batch_closed: 409,
  answers_incomplete: 422,
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * POST /api/factory/{id}/versions (docs/factory-api.md → Versions and revise): a revise session's
 * new version, answering every note of its batch. The answers are checked before anything is
 * stored; the upload is checked like a render. Never queued here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await factoryRequest(request, id, { body: true });
  if (!req.ok) return req.response;
  const { ctx, body } = req.value;

  if (typeof body.batch_id !== "string" || !body.batch_id)
    return apiError(422, "bad_batch", "batch_id is the BATCH= line you were started with.");
  if (typeof body.git_sha !== "string" || !body.git_sha.trim())
    return apiError(
      422,
      "missing_git_sha",
      "git_sha is required: send `git rev-parse HEAD` after committing the film.",
    );
  if (!Array.isArray(body.answers))
    return apiError(
      422,
      "answers_incomplete",
      "answers must list one {note_id, verdict, reply} per note in the batch.",
    );
  const answers: NoteAnswer[] = body.answers.map((a: unknown) => {
    const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    return {
      noteId: typeof o.note_id === "string" ? o.note_id : "",
      status: typeof o.verdict === "string" ? o.verdict : "",
      reply: typeof o.reply === "string" ? o.reply : "",
    };
  });

  try {
    const prepared = await prepareRevision(ctx, id, body.batch_id, answers);
    if (body.proxy !== undefined && body.proxy !== null) {
      const proxyError = await checkProxy(ctx, id, body.proxy);
      if (proxyError) return proxyError;
    }
    const stored = await storeRender(ctx, id, body.upload);
    if (!stored.ok) return stored.response;
    const { info, bytes, mediaId } = stored.value;
    const created = await applyRevision(ctx, id, prepared, {
      mediaId,
      proxyPath: typeof body.proxy === "string" ? body.proxy : null,
      gitSha: body.git_sha.trim(),
      intent: body.intent,
      durationS: Math.round(info.durationS * 1000) / 1000,
      fps: num(body.fps),
      width: info.width,
      height: info.height,
      bytes,
      loudnessLufs: num(body.loudness_lufs),
      truePeakDb: num(body.true_peak_db),
    }).catch(async (err: unknown) => {
      // Nothing points at the stored render: drop its row (the session can upload again).
      await ctx.db
        .from("media_assets")
        .delete()
        .eq("workspace_id", ctx.workspaceId)
        .eq("id", mediaId);
      throw err;
    });
    return NextResponse.json({ version: created.id, number: created.number }, { status: 201 });
  } catch (err) {
    if (err instanceof FactoryError && STATUS[err.code])
      return apiError(STATUS[err.code] ?? 409, err.code, err.message);
    return errorResponse(err);
  }
}
