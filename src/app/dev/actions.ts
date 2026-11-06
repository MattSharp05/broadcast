"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/db/admin";
import { isSignedInOwner } from "@/lib/db/auth";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { runTick } from "@/lib/scheduler/tick";

export interface TickState {
  /** One line for the page: what the tick did, or why it didn't run. */
  message: string;
  /** Increments per run, so the same message twice still reads as a new result. */
  runs: number;
}

/** Labels for the step's non-zero counts, in reading order. */
const LABELS: readonly [string, string][] = [
  ["published", "published"],
  ["uploaded", "uploaded"],
  ["processing", "still processing"],
  ["waiting", "waiting for quota"],
  ["retrying", "retrying"],
  ["failed", "failed"],
  ["paused", "paused"],
];

/**
 * /dev's "Run tick now": one scheduler tick for the Sandbox only (signed-in owner). It doesn't
 * record the heartbeat, so the rail keeps reporting the real cron job.
 */
export async function runSandboxTick(prev: TickState): Promise<TickState> {
  const runs = prev.runs + 1;
  if (!(await isSignedInOwner())) return { message: "Sign in to run a tick.", runs };

  const summary = await runTick({
    db: createAdminSupabase(),
    workspaceIds: [WORKSPACE_IDS.sandbox],
    recordHeartbeat: false,
  });
  revalidatePath("/dev");

  const step = summary.steps.publishDue ?? {};
  if (typeof step.error === "string") return { message: `Tick failed: ${step.error}`, runs };
  const parts = LABELS.flatMap(([key, label]) =>
    typeof step[key] === "number" && step[key] > 0 ? [`${step[key]} ${label}`] : [],
  );
  return {
    message: parts.length ? `Tick done: ${parts.join(", ")}.` : "Tick done: nothing was due.",
    runs,
  };
}
