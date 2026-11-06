import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

export type Db = SupabaseClient<Database>;

export interface TickContext {
  /** Service-role client (the tick works across workspaces; every query names its workspace). */
  db: Db;
  /** Epoch ms after which steps stop starting new work. */
  deadline: number;
  /** Only these workspaces; all when absent. */
  workspaceIds?: readonly string[];
  /** Real time (each workspace's own clock comes from src/lib/clock.ts → nowFor). */
  realNow: () => Date;
}

/** What a step did, for the tick's JSON summary (counts by outcome, or an error). */
export type StepSummary = Record<string, number | string>;

/** One kind of work the tick advances. Steps run in registry order (src/lib/scheduler/tick.ts). */
export interface Step {
  name: string;
  run(ctx: TickContext): Promise<StepSummary>;
}
