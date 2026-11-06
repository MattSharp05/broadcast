import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/db/admin";
import { CRON_SECRET_HEADER, isValidCronSecret } from "@/lib/scheduler/secret";
import { runTick } from "@/lib/scheduler/tick";

export const dynamic = "force-dynamic";
/** Vercel function limit; the tick itself stops starting work after 20 s (ADR 0002). */
export const maxDuration = 30;

/**
 * The scheduler tick (ADR 0002). pg_cron calls it every minute with the `x-cron-secret` header;
 * `pnpm tick` calls it by hand. Wrong or missing secret: 401 and nothing runs.
 */
export async function POST(request: NextRequest) {
  if (!isValidCronSecret(request.headers.get(CRON_SECRET_HEADER), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Wrong or missing cron secret." }, { status: 401 });
  }
  const summary = await runTick({ db: createAdminSupabase() });
  return NextResponse.json(summary);
}
