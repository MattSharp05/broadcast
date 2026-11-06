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
  // Stats (BC-21): snapshots only; the daily follower count isn't worth a mention.
  const stats = summary.steps.collectStats ?? {};
  if (typeof stats.error === "string") parts.push(`stats failed: ${stats.error}`);
  const collected = typeof stats.collected === "number" ? stats.collected : 0;
  if (collected > 0) {
    parts.push(`stats refreshed for ${collected} ${collected === 1 ? "post" : "posts"}`);
  }
  // Connection health (BC-19).
  const health = summary.steps.refreshTokens ?? {};
  if (typeof health.error === "string") parts.push(`token refresh failed: ${health.error}`);
  const renewed = typeof health.refreshed === "number" ? health.refreshed : 0;
  const flagged =
    (typeof health.flagged === "number" ? health.flagged : 0) +
    (typeof stats.flagged === "number" ? stats.flagged : 0);
  if (renewed > 0) parts.push(`${renewed} ${renewed === 1 ? "token" : "tokens"} renewed`);
  if (flagged > 0) {
    parts.push(`${flagged} ${flagged === 1 ? "account needs" : "accounts need"} attention`);
  }
  return {
    message: parts.length ? `Tick done: ${parts.join(", ")}.` : "Tick done: nothing was due.",
    runs,
  };
}
