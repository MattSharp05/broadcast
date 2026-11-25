import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { nowFor } from "@/lib/clock";
import { createAdminSupabase } from "@/lib/db/admin";
import { authenticateRoutineToken } from "@/lib/db/factory-auth";
import { loadWorkspace } from "@/lib/db/workspace";
import type { RoutineCtx } from "@/lib/routines/store";
import { apiError } from "../factory/shared";

/**
 * The planner API (docs/factory-api.md → Routines). Auth is a routine's factory token, minted
 * when "Plan videos" fires the planner session; a video's token is refused. Nothing here builds
 * or posts anything: it only saves briefs.
 */
export async function routineRequest(
  request: NextRequest,
  routineId: string,
  opts: { body?: boolean } = {},
): Promise<
  | { ok: true; ctx: RoutineCtx; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const admin = createAdminSupabase();
  const auth = await authenticateRoutineToken(admin, request.headers.get("authorization"));
  if (!auth)
    return {
      ok: false,
      response: NextResponse.json(
        { error: "unauthorized", message: "Send Authorization: Bearer <the routine's token>." },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
      ),
    };
  if (auth.routineId !== routineId)
    return {
      ok: false,
      response: apiError(403, "wrong_routine", "This token belongs to another routine."),
    };
  let body: Record<string, unknown> = {};
  if (opts.body) {
    const text = await request.text();
    if (text.length > 2 * 1024 * 1024)
      return { ok: false, response: apiError(413, "too_large", "The plan is over 2 MB.") };
    try {
      const parsed: unknown = JSON.parse(text || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, response: apiError(400, "bad_json", "The body must be a JSON object.") };
    }
  }
  const workspace = await loadWorkspace(admin, auth.kind);
  return {
    ok: true,
    body,
    ctx: {
      db: admin,
      workspaceId: auth.workspaceId,
      now: nowFor(workspace),
      timezone: workspace.timezone ?? "UTC",
    },
  };
}
