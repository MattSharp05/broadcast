import { NextResponse, type NextRequest } from "next/server";
import { parseNowParam } from "@/lib/clock";
import { safeNextPath } from "@/lib/db/access";
import { createAdminSupabase } from "@/lib/db/admin";
import { isSignedInOwner } from "@/lib/db/auth";
import { setWorkspaceKind } from "@/lib/db/workspace";
import { SCENARIOS, getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";

export const dynamic = "force-dynamic";

/**
 * Resets the Sandbox and loads a scenario (signed-in owner only; works on production because it
 * only touches the Sandbox, ADR 0003). Switches the dashboard to the Sandbox.
 * - `?now=ISO` freezes the Sandbox clock at that time; without it the Sandbox runs on real time.
 * - `?next=/path` redirects there afterwards (how `/workflow?scenario=…` arrives, via the
 *   middleware); without it the response is a JSON summary.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  if (!(await isSignedInOwner())) {
    return NextResponse.json({ error: "Sign in to load a scenario." }, { status: 401 });
  }
  const { name } = await params;
  const scenario = getScenario(name);
  if (!scenario) {
    return NextResponse.json(
      { error: `No scenario called "${name}".`, scenarios: SCENARIOS.map((s) => s.name) },
      { status: 404 },
    );
  }
  const search = request.nextUrl.searchParams;
  const nowParam = search.get("now");
  const fixedNow = parseNowParam(nowParam);
  if (nowParam && !fixedNow) {
    return NextResponse.json(
      { error: "now must be an ISO date-time with a zone, e.g. 2026-11-05T22:14:00Z." },
      { status: 400 },
    );
  }

  const loaded = await loadScenario(createAdminSupabase(), scenario, { fixedNow });
  await setWorkspaceKind("sandbox");

  const next = search.get("next");
  if (next) return NextResponse.redirect(new URL(safeNextPath(next), request.url), 303);
  return NextResponse.json(loaded);
}
