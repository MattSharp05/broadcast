import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { claim } from "@/lib/scheduler/claim";
import { runTick, type TickSummary } from "@/lib/scheduler/tick";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { DUE_CAPTION } from "@/lib/scenarios/publish-due-now";
import { ALLOWED_EMAIL, adminClient, setAllowedEmail, signedInClient } from "./helpers";

// BC-12: the scheduler tick against the local database: claiming, the publish step, the job log
// and the heartbeat. Sandbox only (fake provider).

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");
const scenario = getScenario("publish-due-now");

async function load() {
  if (!scenario) throw new Error("publish-due-now is not registered");
  await loadScenario(admin, scenario, { fixedNow: NOW });
}

const sandboxTick = () => runTick({ db: admin, workspaceIds: [SANDBOX], recordHeartbeat: false });

function total(summaries: TickSummary[], key: string): number {
  return summaries.reduce((n, s) => n + Number(s.steps.publishDue?.[key] ?? 0), 0);
}

async function duePost() {
  const { data, error } = await admin
    .from("posts")
    .select("*")
    .eq("workspace_id", SANDBOX)
    .eq("caption", DUE_CAPTION)
    .single();
  if (error) throw error;
  return data;
}

async function containers() {
  const { data, error } = await admin
    .from("fake_containers")
    .select("*")
    .eq("workspace_id", SANDBOX);
  if (error) throw error;
  return data;
}

describe("scheduler tick", () => {
  beforeEach(load);

  afterAll(async () => {
    await admin.rpc("reset_sandbox");
  });

  it("two concurrent ticks publish a due fake post exactly once", async () => {
    // Tick 1 (twice at once): exactly one container is created.
    const first = await Promise.all([sandboxTick(), sandboxTick()]);
    expect(total(first, "claimed")).toBe(1);
    expect(total(first, "uploaded")).toBe(1);
    expect(await containers()).toHaveLength(1);
    let post = await duePost();
    expect(post.status).toBe("publishing");
    expect(post.container_id).toBe((await containers())[0]?.id);
    expect(post.claim_token).toBeNull();

    // Tick 2 (twice at once): it is published once.
    const second = await Promise.all([sandboxTick(), sandboxTick()]);
    expect(total(second, "published")).toBe(1);
    post = await duePost();
    expect(post.status).toBe("published");
    expect(post.published_at && new Date(post.published_at).toISOString()).toBe(NOW.toISOString());
    expect(post.permalink).toMatch(/^https:\/\/fake\.broadcast\.invalid\/due\.now\/reel\//);
    const made = await containers();
    expect(made).toHaveLength(1);
    expect(made[0]?.media_id).toBe(post.media_ig_id);

    // Tick 3: nothing left to do; the other post waits for its slot.
    const third = await Promise.all([sandboxTick(), sandboxTick()]);
    expect(total(third, "claimed")).toBe(0);
    const { data: others } = await admin
      .from("posts")
      .select("status")
      .eq("workspace_id", SANDBOX)
      .neq("caption", DUE_CAPTION);
    expect(others?.map((p) => p.status)).toEqual(["queued"]);

    // The job log has one line per step.
    const { data: log } = await admin
      .from("job_log")
      .select("kind, ok, message, post_id")
      .eq("workspace_id", SANDBOX)
      .order("id");
    expect(log?.map((l) => [l.kind, l.ok, l.post_id])).toEqual([
      ["publish", true, post.id],
      ["publish", true, post.id],
    ]);
    expect(log?.[1]?.message).toBe(`Published: ${post.permalink}`);
  });

  it("claim never hands the same row to two callers", async () => {
    const [a, b] = await Promise.all([
      claim(admin, "publish", 10, { platforms: ["fake"], workspaceIds: [SANDBOX] }),
      claim(admin, "publish", 10, { platforms: ["fake"], workspaceIds: [SANDBOX] }),
    ]);
    expect(a.length + b.length).toBe(1);
    // Leased: a later claim gets nothing until the lease ends.
    expect(
      await claim(admin, "publish", 10, { platforms: ["fake"], workspaceIds: [SANDBOX] }),
    ).toEqual([]);
  });

  it("does not claim posts on other platforms or outside the given workspaces", async () => {
    expect(
      await claim(admin, "publish", 10, { platforms: ["instagram"], workspaceIds: [SANDBOX] }),
    ).toEqual([]);
    expect(
      await claim(admin, "publish", 10, {
        platforms: ["fake"],
        workspaceIds: [WORKSPACE_IDS.live],
      }),
    ).toEqual([]);
  });

  it("a network error schedules a retry in 1 minute and logs it", async () => {
    const post = await duePost();
    await admin
      .from("fake_accounts")
      .update({ failure_mode: "network", failures_left: null })
      .eq("account_id", post.account_id);

    const [summary] = await Promise.all([sandboxTick()]);
    expect(summary.steps.publishDue).toMatchObject({ claimed: 1, retrying: 1 });
    const after = await duePost();
    expect(after).toMatchObject({ status: "queued", attempts: 1, container_id: null });
    expect(after.next_attempt_at && new Date(after.next_attempt_at).toISOString()).toBe(
      new Date(NOW.getTime() + 60_000).toISOString(),
    );
    expect(after.last_error).toContain("Couldn't reach Instagram");

    // The Sandbox clock is frozen at NOW: the retry isn't due yet.
    expect((await sandboxTick()).steps.publishDue).toMatchObject({ claimed: 0 });
  });

  it("an account that needs attention pauses its due post", async () => {
    const post = await duePost();
    await admin
      .from("social_accounts")
      .update({ status: "needs_attention", status_reason: "Reconnect @due.now." })
      .eq("id", post.account_id);
    expect((await sandboxTick()).steps.publishDue).toMatchObject({ paused: 1 });
    expect(await duePost()).toMatchObject({ status: "paused", last_error: "Reconnect @due.now." });
    expect(await containers()).toHaveLength(0);
  });

  it("an exhausted quota makes the post wait without using a retry", async () => {
    const post = await duePost();
    await admin
      .from("fake_accounts")
      .update({ failure_mode: "quota_exhausted", failures_left: null })
      .eq("account_id", post.account_id);
    expect((await sandboxTick()).steps.publishDue).toMatchObject({ waiting: 1 });
    expect(await duePost()).toMatchObject({ status: "queued", attempts: 0 });
    expect(await containers()).toHaveLength(0);
  });
});

describe("scheduler heartbeat", () => {
  afterAll(async () => {
    await admin
      .from("scheduler_status")
      .update({ last_tick_at: null, last_tick_ms: null, last_summary: null })
      .eq("id", true);
    await setAllowedEmail(null);
  });

  it("a real tick records last_tick_at, which the allowed user can read but not change", async () => {
    const started = new Date("2026-11-06T04:00:00Z");
    await runTick({ db: admin, steps: [], realNow: () => started });
    const { data } = await admin.from("scheduler_status").select("*").single();
    expect(data?.last_tick_at && new Date(data.last_tick_at).toISOString()).toBe(
      started.toISOString(),
    );
    expect(data?.last_summary).toMatchObject({ steps: {} });

    await setAllowedEmail(ALLOWED_EMAIL);
    const user = await signedInClient(ALLOWED_EMAIL);
    const read = await user.from("scheduler_status").select("last_tick_at").single();
    expect(read.error).toBeNull();
    const write = await user.from("scheduler_status").update({ last_tick_at: null }).eq("id", true);
    expect(write.error?.code).toBe("42501");
  });

  it("a Sandbox-only tick from /dev leaves the heartbeat alone", async () => {
    const before = (await admin.from("scheduler_status").select("last_tick_at").single()).data;
    await runTick({ db: admin, workspaceIds: [SANDBOX], recordHeartbeat: false, steps: [] });
    const after = (await admin.from("scheduler_status").select("last_tick_at").single()).data;
    expect(after).toEqual(before);
  });
});
