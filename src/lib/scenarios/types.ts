import type { Database } from "@/lib/db/types";

type Insert<T extends keyof Database["public"]["Tables"]> = Omit<
  Database["public"]["Tables"][T]["Insert"],
  "workspace_id" | "created_at" | "updated_at"
>;

/**
 * Everything a scenario puts in the Sandbox. Rows carry no workspace_id: the loader adds the
 * Sandbox id to every row, so a scenario can't write anywhere else.
 */
export interface SandboxSeed {
  /** IANA timezone for the Sandbox's slot maths and display. */
  timezone: string;
  brands: Insert<"brands">[];
  accounts: Insert<"social_accounts">[];
  fakeAccounts: Insert<"fake_accounts">[];
  /** The fake provider's record of already-published posts (so their stats can be fetched). */
  fakeContainers: Insert<"fake_containers">[];
  media: Insert<"media_assets">[];
  posts: Insert<"posts">[];
  postMetrics: Insert<"post_metrics">[];
  accountMetrics: Insert<"account_metrics">[];
  jobLog: Insert<"job_log">[];
}

export interface ScenarioContext {
  /** The scenario's "now": `?now=` when given, else the real time (to the minute). */
  now: Date;
  /** Seeded random numbers in [0, 1), the same sequence on every load. */
  rng: () => number;
}

export interface Scenario {
  /** URL name: `/workflow?scenario=<name>`. */
  name: string;
  /** One line for /dev: what state it sets up. */
  description: string;
  build(ctx: ScenarioContext): SandboxSeed;
}

export function emptySeed(timezone: string): SandboxSeed {
  return {
    timezone,
    brands: [],
    accounts: [],
    fakeAccounts: [],
    fakeContainers: [],
    media: [],
    posts: [],
    postMetrics: [],
    accountMetrics: [],
    jobLog: [],
  };
}
