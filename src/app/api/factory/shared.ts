import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { nowFor } from "@/lib/clock";
import { createAdminSupabase } from "@/lib/db/admin";
import { authenticateFactoryToken, type FactoryAuth } from "@/lib/db/factory-auth";
import { FactoryError } from "@/lib/db/factory";
import { loadWorkspace } from "@/lib/db/workspace";
import type { EngineContext } from "@/lib/factory/engine";
import { GenError } from "@/lib/factory/gen";

/**
 * Shared by the factory API and the generation proxy (docs/factory-api.md). Auth is a factory
 * token for one video. Nothing here publishes: posting happens only from the dashboard.
 */

export function apiError(
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json({ error, message, ...extra }, { status });
}

const UNAUTHORIZED = () =>
  NextResponse.json(
    {
      error: "unauthorized",
      message: "Send Authorization: Bearer <factory token> (a valid, unexpired one).",
    },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );

export interface FactoryRequest {
  auth: FactoryAuth;
  ctx: EngineContext;
  body: Record<string, unknown>;
}

// Vercel functions take at most 4.5 MB: bigger files go through /assets.
const MAX_BODY = 4 * 1024 * 1024;

/** The token (for `productionId` when given) and the JSON body, or the response refusing them. */
export async function factoryRequest(
  request: NextRequest,
  productionId: string | null,
  opts: { body?: boolean } = {},
): Promise<{ ok: true; value: FactoryRequest } | { ok: false; response: NextResponse }> {
  const admin = createAdminSupabase();
  const auth = await authenticateFactoryToken(admin, request.headers.get("authorization"));
  if (!auth) return { ok: false, response: UNAUTHORIZED() };
  if (productionId !== null && productionId !== auth.productionId) {
    return {
      ok: false,
      response: apiError(403, "wrong_video", "This token belongs to another video."),
    };
  }
  let body: Record<string, unknown> = {};
  if (opts.body) {
    const text = await request.text();
    if (text.length > MAX_BODY) {
      return {
        ok: false,
        response: apiError(
          413,
          "too_large",
          "The body is over 4 MB. Upload big files through /assets and send the storage: path.",
        ),
      };
    }
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
    value: {
      auth,
      body,
      ctx: {
        db: admin,
        workspaceId: auth.workspaceId,
        now: nowFor(workspace),
        appUrl: request.nextUrl.origin,
      },
    },
  };
}

/** Turns thrown errors into the API's JSON errors. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof GenError) return apiError(err.status, err.code, err.message, err.extra);
  if (err instanceof FactoryError) {
    const status = err.code === "not_found" ? 404 : 409;
    return apiError(status, err.code, err.message);
  }
  console.error("Factory API failed:", err);
  return apiError(
    500,
    "server_error",
    "Something went wrong on the server. Try again in a moment.",
  );
}
