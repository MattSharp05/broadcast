import type { Json } from "@/lib/db/types";
import { publishDue } from "./publish-due";
import type { Db, Step, StepSummary } from "./types";

export type { Step, StepSummary, TickContext } from "./types";

/** A tick's time budget (ADR 0002: return within about 20 s). */
export const TICK_BUDGET_MS = 20_000;

/**
 * The steps every tick runs, in order. BC-16 (Instagram publishing), BC-21 (stats) and BC-19
 * (token refresh) add theirs here.
 */
export const STEPS: readonly Step[] = [publishDue];

export interface TickOptions {
  db: Db;
  /** Only these workspaces (the /dev button: the Sandbox); all when absent. */
  workspaceIds?: readonly string[];
  /**
   * Record the heartbeat the rail reads (scheduler_status.last_tick_at). True for real ticks;
   * false for a Sandbox-only tick from /dev, which says nothing about the cron job.
   */
  recordHeartbeat?: boolean;
  steps?: readonly Step[];
  budgetMs?: number;
  realNow?: () => Date;
}

export interface TickSummary {
  startedAt: string;
  ms: number;
  steps: Record<string, StepSummary>;
}

/**
 * One scheduler tick: runs every step in order within the budget, then records the heartbeat.
 * A step that throws is reported in the summary and doesn't stop the others.
 */
export async function runTick(options: TickOptions): Promise<TickSummary> {
  const realNow = options.realNow ?? (() => new Date());
  const started = realNow();
  const deadline = started.getTime() + (options.budgetMs ?? TICK_BUDGET_MS);
  const steps: Record<string, StepSummary> = {};

  for (const step of options.steps ?? STEPS) {
    if (realNow().getTime() > deadline) {
      steps[step.name] = { skipped: "out of time" };
      continue;
    }
    try {
      steps[step.name] = await step.run({
        db: options.db,
        deadline,
        workspaceIds: options.workspaceIds,
        realNow,
      });
    } catch (err) {
      console.error(`Scheduler step ${step.name} failed:`, err);
      steps[step.name] = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  const summary: TickSummary = {
    startedAt: started.toISOString(),
    ms: realNow().getTime() - started.getTime(),
    steps,
  };

  if (options.recordHeartbeat ?? true) {
    const { error } = await options.db
      .from("scheduler_status")
      .update({
        last_tick_at: started.toISOString(),
        last_tick_ms: summary.ms,
        last_summary: summary as unknown as Json,
      })
      .eq("id", true);
    if (error) console.error(`Recording the scheduler heartbeat failed: ${error.message}`);
  }
  return summary;
}
