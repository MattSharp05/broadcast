import { NextResponse, type NextRequest } from "next/server";
import { loadWorkspace } from "@/lib/db/workspace";
import { stylePack } from "@/lib/domain/factory/styles";
import { mintFactoryToken } from "@/lib/factory/engine";
import { importProduction } from "@/lib/factory/studio";
import { nowFor } from "@/lib/clock";
import { authorizedBody, problemResponse, SERVER_ERROR } from "../../content/shared";

export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

function bad(error: string, message: string) {
  return NextResponse.json({ error, message }, { status: 422 });
}

/**
 * POST /api/factory/import (content API key, like /api/content; docs/factory-api.md → Import):
 * `{project_slug, title, idea, style?}` makes a video for an existing video-editor project, with
 * every step skipped but the render, and returns a factory token so the session can upload v1
 * (`/assets`, then `/versions` with no batch). Nothing is queued.
 */
export async function POST(request: NextRequest) {
  const req = await authorizedBody(request);
  if (!req.ok) return req.response;
  const { admin, auth, body } = req;
  const slug = typeof body.project_slug === "string" ? body.project_slug.trim() : "";
  if (!SLUG.test(slug))
    return bad("bad_slug", "project_slug is the folder name under projects/ (a-z, 0-9, dashes).");
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return bad("bad_title", "Send the video's title.");
  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  if (!idea) return bad("bad_idea", "Send the brief's one-paragraph summary as idea.");
  const style = typeof body.style === "string" && stylePack(body.style) ? body.style : null;
  try {
    const workspace = await loadWorkspace(admin, auth.kind);
    const ctx = { db: admin, workspaceId: auth.workspaceId, now: nowFor(workspace) };
    const { id, existing } = await importProduction(ctx, {
      projectSlug: slug,
      title,
      idea,
      style,
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "already_imported",
          message: `projects/${slug} is already the video ${id}. Open it in the studio instead.`,
          video_id: id,
        },
        { status: 409 },
      );
    }
    const token = await mintFactoryToken(ctx, id);
    return NextResponse.json({ video_id: id, token }, { status: 201 });
  } catch (err) {
    console.error("Factory import failed:", err);
    return problemResponse(SERVER_ERROR);
  }
}
