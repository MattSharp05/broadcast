import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/db/admin";
import { authenticateApiKey, type ApiKeyAuth } from "@/lib/db/api-keys";
import { UNAUTHORIZED, parseJsonBody, type ApiProblem } from "@/lib/domain/content-api";

/**
 * Shared by the content API's routes (BC-17, docs/content-api.md). JSON errors are
 * `{ error, message }`. Nothing here, or in the routes, publishes: the API only queues (CLAUDE.md
 * → Rules; `no-publish.test.ts` checks the import graph).
 */

export type Admin = ReturnType<typeof createAdminSupabase>;

export function problemResponse(p: ApiProblem, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error: p.error, message: p.message }, { status: p.status, headers });
}

export const SERVER_ERROR: ApiProblem = {
  status: 500,
  error: "server_error",
  message: "Something went wrong on the server. Try again in a moment.",
};

/**
 * The request's API key and JSON body, or the response that refuses it. The key is checked first,
 * so nothing about the body is revealed to a caller without one.
 */
export async function authorizedBody(
  request: NextRequest,
): Promise<
  | { ok: true; admin: Admin; auth: ApiKeyAuth; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const admin = createAdminSupabase();
  const auth = await authenticateApiKey(admin, request.headers.get("authorization"));
  if (!auth) {
    return {
      ok: false,
      response: problemResponse(UNAUTHORIZED, { "WWW-Authenticate": "Bearer" }),
    };
  }
  const body = parseJsonBody(await request.text());
  if (!body.ok) return { ok: false, response: problemResponse(body.problem) };
  return { ok: true, admin, auth, body: body.value };
}
