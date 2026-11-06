import { NextResponse, type NextRequest } from "next/server";
import { parseNowParam } from "@/lib/clock";
import { safeNextPath } from "@/lib/db/access";
import { createAdminSupabase } from "@/lib/db/admin";
import { isSignedInOwner } from "@/lib/db/auth";
import { setWorkspaceKind } from "@/lib/db/workspace";
import { setSandboxClock } from "@/lib/scenarios/load";

export const dynamic = "force-dynamic";

/**
 * Sets the Sandbox clock (signed-in owner only) and switches to the Sandbox: `?now=ISO` freezes
 * it, `?now=` (empty) or `?now=real` goes back to real time. The Live clock is always real.
 * `?next=/path` redirects there afterwards; otherwise JSON.
 */
export async function GET(request: NextRequest) {
  if (!(await isSignedInOwner())) {
    return NextResponse.json({ error: "Sign in to set the Sandbox clock." }, { status: 401 });
  }
  const search = request.nextUrl.searchParams;
  const nowParam = search.get("now") ?? "";
  const real = nowParam === "" || nowParam === "real";
  const fixedNow = real ? null : parseNowParam(nowParam);
  if (!real && !fixedNow) {
    return NextResponse.json(
      { error: "now must be an ISO date-time with a zone, e.g. 2026-11-05T22:14:00Z, or real." },
      { status: 400 },
    );
  }
  await setSandboxClock(createAdminSupabase(), fixedNow);
  await setWorkspaceKind("sandbox");

  const next = search.get("next");
  if (next) return NextResponse.redirect(new URL(safeNextPath(next), request.url), 303);
  return NextResponse.json({ clockOverride: fixedNow?.toISOString() ?? null });
}
