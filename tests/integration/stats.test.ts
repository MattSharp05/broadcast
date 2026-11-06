import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { followerDay } from "@/lib/domain/stats-schedule";
import { fakeInsights } from "@/lib/providers/fake";
import { RETRY_BACKOFF_S, collectStats } from "@/lib/scheduler/collect-stats";
import { runTick, type TickSummary } from "@/lib/scheduler/tick";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { STATS_DUE_FOLLOWERS, statsDueMediaId } from "@/lib/scenarios/stats-due";
import { stableUuid } from "@/lib/hash";
import { adminClient } from "./helpers";

// BC-21: the scheduler's stats step against the local database, on the Sandbox (fake provider).

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");
const FRESH = stableUuid("stats-due", "post", "fresh");
const BEHIND = stableUuid("stats-due", "post", "behind");
const ACCOUNT = stableUuid("stats-due", "account");

async function load() {
  const scenario = getScenario("stats-due");
  if (!scenario) throw new Error("stats-due is not registered");
  await loadScenario(admin, scenario, { fixedNow: NOW });
}

const statsTick = () =>
  runTick({ db: admin, workspaceIds: [SANDBOX], recordHeartbeat: false, steps: [collectStats] });

const sum = (summaries: TickSummary[], key: string) =>
  summaries.reduce((n, s) => n + Number(s.steps.collectStats?.[key] ?? 0), 0);

async function metrics(postId: string) {
  const { data, error } = await admin
    .from("post_metrics")
    .select("stat_offset, taken_at, missed, views, reach, likes, comments, shares, saves")
    .eq("workspace_id", SANDBOX)
    .eq("post_id", postId);
  if (error) throw error;
  return Object.fromEntries(data.map((m) => [m.stat_offset, m]));
}

describe("stats step", () => {
  beforeEach(load);
  afterAll(async () => {
    await admin.rpc("reset_sandbox");
  });

  it("fills the due snapshots and today's followers once, even with two ticks at once", async () => {
    const first = await Promise.all([statsTick(), statsTick()]);
    expect(sum(first, "claimed")).toBe(2);
    expect(sum(first, "collected")).toBe(2);

    const fresh = await metrics(FRESH);
    const expected = fakeInsights(statsDueMediaId("fresh"), STATS_DUE_FOLLOWERS, 65 / 60);
    expect(fresh["1h"]).toMatchObject({ ...expected, missed: false });
    expect(fresh["1h"]?.taken_at && new Date(fresh["1h"].taken_at).toISOString()).toBe(
      NOW.toISOString(),
    );
    expect(fresh["6h"]?.taken_at).toBeNull();

    // Catch-up: today's numbers go to 48 h only; 6 h and 24 h are marked missed.
    const behind = await metrics(BEHIND);
    expect(behind["48h"]).toMatchObject({
      ...fakeInsights(statsDueMediaId("behind"), STATS_DUE_FOLLOWERS, 50),
      missed: false,
    });
    for (const o of ["6h", "24h"]) {
      expect(behind[o]).toMatchObject({ missed: true, views: null, likes: null });
      expect(behind[o]?.taken_at).not.toBeNull();
    }
    expect(behind["7d"]?.taken_at).toBeNull();

    // Followers: once today (two ticks at once may both ask; there's still one row).
    const { data: days } = await admin
      .from("account_metrics")
      .select("day, followers")
      .eq("workspace_id", SANDBOX)
      .eq("account_id", ACCOUNT)
      .eq("day", followerDay(NOW, "Europe/London"));
    expect(days).toEqual([{ day: "2026-11-05", followers: STATS_DUE_FOLLOWERS }]);

    // Nothing left: the next tick claims nothing and doesn't ask for followers again.
    const again = await statsTick();
    expect(again.steps.collectStats).toMatchObject({ claimed: 0, collected: 0, followers: 0 });
  });

  it("a failing call backs off the post and logs it; followers aren't retried for an hour", async () => {
    await admin
      .from("fake_accounts")
      .update({ failure_mode: "network", failures_left: null })
      .eq("account_id", ACCOUNT);

    const started = Date.now();
    const summary = await statsTick();
    expect(summary.steps.collectStats).toMatchObject({
      claimed: 2,
      collected: 0,
      retrying: 2,
      followerErrors: 1,
    });
    expect((await metrics(FRESH))["1h"]?.taken_at).toBeNull();

    const { data: post } = await admin
      .from("posts")
      .select("claimed_until, claim_token")
      .eq("id", FRESH)
      .single();
    expect(post?.claim_token).toBeNull();
    const until = new Date(post?.claimed_until ?? 0).getTime();
    expect(until).toBeGreaterThanOrEqual(started + (RETRY_BACKOFF_S - 5) * 1000);

    const { data: log } = await admin
      .from("job_log")
      .select("kind, ok, post_id")
      .eq("workspace_id", SANDBOX)
      .order("id");
    expect(log?.filter((l) => l.kind === "stats")).toHaveLength(2);
    expect(log?.filter((l) => l.kind === "followers")).toHaveLength(1);
    expect(log?.every((l) => !l.ok)).toBe(true);

    // Backing off: the next tick neither claims the posts nor asks for followers.
    expect((await statsTick()).steps.collectStats).toMatchObject({
      claimed: 0,
      followerErrors: 0,
    });
  });

  it("a post Instagram no longer has: its due snapshots are marked missed", async () => {
    await admin.from("fake_containers").delete().eq("media_id", statsDueMediaId("fresh"));
    const summary = await statsTick();
    expect(summary.steps.collectStats).toMatchObject({ collected: 1 });
    expect((await metrics(FRESH))["1h"]).toMatchObject({ missed: true, views: null });
  });

  it("runs after publishing in the full tick", async () => {
    const summary = await runTick({ db: admin, workspaceIds: [SANDBOX], recordHeartbeat: false });
    expect(Object.keys(summary.steps)).toEqual(["publishDue", "collectStats"]);
    expect(summary.steps.collectStats).toMatchObject({ collected: 2 });
  });
});
