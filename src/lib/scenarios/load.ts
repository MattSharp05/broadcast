import type { SupabaseClient } from "@supabase/supabase-js";
import { floorToMinute } from "@/lib/clock";
import type { Database } from "@/lib/db/types";
import { clearWorkspaceUploads } from "@/lib/db/videos";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { createRng, hash32 } from "@/lib/hash";
import type { SandboxSeed, Scenario } from "./types";

export interface LoadedScenario {
  scenario: string;
  /** The scenario's "now" (ISO). */
  now: string;
  /** True when the Sandbox clock is frozen at `now` (a `?now=` was given). */
  fixedClock: boolean;
  counts: Record<keyof Omit<SandboxSeed, "timezone">, number>;
}

/**
 * Adds the Sandbox id to every row: whatever a scenario returns lands in the Sandbox. (Inserts use
 * `defaultToNull: false`, so a column one row leaves out gets its default, not null.)
 */
function inSandbox<T extends object>(rows: readonly T[]): (T & { workspace_id: string })[] {
  return rows.map((row) => ({ ...row, workspace_id: WORKSPACE_IDS.sandbox }));
}

async function run(what: string, query: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await query;
  if (error) throw new Error(`Loading the scenario failed at ${what}: ${error.message}`);
}

/**
 * Resets the Sandbox workspace and seeds a scenario. Needs the service-role client (it writes the
 * fake provider's tables). Never touches the Live workspace: the reset is the `reset_sandbox()`
 * database function, and every inserted row gets the Sandbox's workspace_id.
 *
 * `fixedNow` (from `?now=`) freezes the Sandbox clock; without it the scenario is built around the
 * real time and the Sandbox runs on real time.
 */
export async function loadScenario(
  db: SupabaseClient<Database>,
  scenario: Scenario,
  options: { fixedNow?: Date | null; realNow?: Date } = {},
): Promise<LoadedScenario> {
  const now = options.fixedNow ?? floorToMinute(options.realNow ?? new Date());
  const seed = scenario.build({ now, rng: createRng(hash32(scenario.name)) });

  await run("reset", db.rpc("reset_sandbox"));
  await clearWorkspaceUploads(db, WORKSPACE_IDS.sandbox);
  await run(
    "settings",
    db
      .from("settings")
      .update({
        timezone: seed.timezone,
        clock_override: options.fixedNow ? options.fixedNow.toISOString() : null,
      })
      .eq("workspace_id", WORKSPACE_IDS.sandbox),
  );
  if (seed.brands.length)
    await run("brands", db.from("brands").insert(inSandbox(seed.brands), { defaultToNull: false }));
  if (seed.accounts.length) {
    await run(
      "accounts",
      db.from("social_accounts").insert(inSandbox(seed.accounts), { defaultToNull: false }),
    );
  }
  if (seed.fakeAccounts.length) {
    await run(
      "fake accounts",
      db.from("fake_accounts").insert(inSandbox(seed.fakeAccounts), { defaultToNull: false }),
    );
  }
  if (seed.credentials.length) {
    await run(
      "credentials",
      db.from("oauth_credentials").insert(inSandbox(seed.credentials), { defaultToNull: false }),
    );
  }
  if (seed.fakeContainers.length) {
    await run(
      "fake containers",
      db.from("fake_containers").insert(inSandbox(seed.fakeContainers), { defaultToNull: false }),
    );
  }
  if (seed.media.length)
    await run(
      "media",
      db.from("media_assets").insert(inSandbox(seed.media), { defaultToNull: false }),
    );
  if (seed.posts.length)
    await run("posts", db.from("posts").insert(inSandbox(seed.posts), { defaultToNull: false }));
  if (seed.postMetrics.length) {
    await run(
      "post metrics",
      db.from("post_metrics").insert(inSandbox(seed.postMetrics), { defaultToNull: false }),
    );
  }
  if (seed.accountMetrics.length) {
    await run(
      "account metrics",
      db.from("account_metrics").insert(inSandbox(seed.accountMetrics), { defaultToNull: false }),
    );
  }
  if (seed.jobLog.length)
    await run(
      "job log",
      db.from("job_log").insert(inSandbox(seed.jobLog), { defaultToNull: false }),
    );

  await loadFactory(db, seed.factory);

  return {
    scenario: scenario.name,
    now: now.toISOString(),
    fixedClock: Boolean(options.fixedNow),
    counts: {
      brands: seed.brands.length,
      accounts: seed.accounts.length,
      fakeAccounts: seed.fakeAccounts.length,
      credentials: seed.credentials.length,
      fakeContainers: seed.fakeContainers.length,
      media: seed.media.length,
      posts: seed.posts.length,
      postMetrics: seed.postMetrics.length,
      accountMetrics: seed.accountMetrics.length,
      jobLog: seed.jobLog.length,
      factory:
        (seed.factory.settings ? 1 : 0) +
        seed.factory.avatars.length +
        seed.factory.avatarVersions.length +
        seed.factory.productions.length +
        seed.factory.steps.length +
        seed.factory.reworks.length +
        seed.factory.genJobs.length +
        seed.factory.heroProposals.length +
        seed.factory.heroDecisions.length,
    },
  };
}

/** Freezes the Sandbox clock at `fixedNow`, or back to real time with null. */
export async function setSandboxClock(
  db: SupabaseClient<Database>,
  fixedNow: Date | null,
): Promise<void> {
  await run(
    "clock",
    db
      .from("settings")
      .update({ clock_override: fixedNow ? fixedNow.toISOString() : null })
      .eq("workspace_id", WORKSPACE_IDS.sandbox),
  );
}

async function loadFactory(db: SupabaseClient<Database>, f: SandboxSeed["factory"]): Promise<void> {
  if (f.settings) {
    await run(
      "factory settings",
      db.from("factory_settings").update(f.settings).eq("workspace_id", WORKSPACE_IDS.sandbox),
    );
  }
  const tables = [
    ["avatars", f.avatars],
    ["avatar_versions", f.avatarVersions],
    ["productions", f.productions],
    ["production_steps", f.steps],
    ["production_reworks", f.reworks],
    ["gen_jobs", f.genJobs],
    ["hero_proposals", f.heroProposals],
    ["hero_decisions", f.heroDecisions],
  ] as const;
  for (const [table, rows] of tables) {
    if (!rows.length) continue;
    await run(table, db.from(table).insert(inSandbox(rows as never[]), { defaultToNull: false }));
  }
}
