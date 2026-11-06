import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { createFakeProvider } from "@/lib/providers/fake";
import { createDbFakeStore } from "@/lib/providers/fake-store";
import { SCENARIOS, getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { ALL_TABLES, adminClient, anonClient, type TableName } from "./helpers";

const admin = adminClient();
const LIVE = WORKSPACE_IDS.live;
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");

/** Tables with a workspace_id (all but the global ones and workspaces itself). */
const WORKSPACE_TABLES = ALL_TABLES.filter(
  (t): t is Exclude<TableName, "app_settings" | "scheduler_status" | "workspaces"> =>
    t !== "app_settings" && t !== "scheduler_status" && t !== "workspaces",
);

async function liveSnapshot(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of WORKSPACE_TABLES) {
    const { data, error } = await admin.from(table).select("*").eq("workspace_id", LIVE);
    if (error) throw new Error(`${table}: ${error.message}`);
    out[table] = sortRows(data);
  }
  const ws = await admin.from("workspaces").select("*");
  out.workspaces = sortRows(ws.data ?? []);
  return out;
}

function sortRows(rows: unknown[]): unknown[] {
  return [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

async function count(table: (typeof WORKSPACE_TABLES)[number], workspaceId: string) {
  const res = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

describe("scenarios", () => {
  let liveBrandId = "";
  let liveMediaId = "";

  beforeAll(async () => {
    // Some Live data that must survive every scenario load.
    const brand = await admin
      .from("brands")
      .insert({ workspace_id: LIVE, name: "Live brand (scenario test)" })
      .select("id")
      .single();
    if (brand.error) throw brand.error;
    liveBrandId = brand.data.id;
    const account = await admin
      .from("social_accounts")
      .insert({
        workspace_id: LIVE,
        brand_id: liveBrandId,
        platform: "instagram",
        handle: "live_account",
        slots: ["09:00"],
      })
      .select("id")
      .single();
    if (account.error) throw account.error;
    const media = await admin
      .from("media_assets")
      .insert({ workspace_id: LIVE, storage_path: `live/${crypto.randomUUID()}.mp4` })
      .select("id")
      .single();
    if (media.error) throw media.error;
    liveMediaId = media.data.id;
    const post = await admin
      .from("posts")
      .insert({ workspace_id: LIVE, account_id: account.data.id, media_id: liveMediaId })
      .select("id")
      .single();
    if (post.error) throw post.error;
    const log = await admin
      .from("job_log")
      .insert({ workspace_id: LIVE, kind: "scenario-test", ok: true, post_id: post.data.id });
    if (log.error) throw log.error;
    await admin.from("settings").update({ timezone: "America/New_York" }).eq("workspace_id", LIVE);
  });

  afterAll(async () => {
    await admin.from("job_log").delete().eq("kind", "scenario-test");
    await admin.from("brands").delete().eq("id", liveBrandId);
    await admin.from("media_assets").delete().eq("id", liveMediaId);
    await admin.from("settings").update({ timezone: null }).eq("workspace_id", LIVE);
    await admin.rpc("reset_sandbox");
  });

  it("loading every scenario (twice) never changes a Live row", async () => {
    const before = await liveSnapshot();
    expect((before.brands ?? []).length).toBeGreaterThan(0);
    for (const scenario of SCENARIOS) {
      await loadScenario(admin, scenario, { fixedNow: NOW });
      await loadScenario(admin, scenario);
    }
    expect(await liveSnapshot()).toEqual(before);
  });

  it("canvas-busy seeds the Sandbox with what it promises, and only the Sandbox", async () => {
    const scenario = getScenario("canvas-busy");
    if (!scenario) throw new Error("missing canvas-busy");
    const loaded = await loadScenario(admin, scenario, { fixedNow: NOW });

    expect(await count("brands", SANDBOX)).toBe(5);
    expect(await count("social_accounts", SANDBOX)).toBe(5);
    expect(await count("posts", SANDBOX)).toBe(loaded.counts.posts);
    expect(await count("post_metrics", SANDBOX)).toBe(loaded.counts.postMetrics);
    expect(await count("fake_accounts", SANDBOX)).toBe(5);
    expect(await count("fake_containers", SANDBOX)).toBe(loaded.counts.fakeContainers);

    // A seeded published post's stats can be fetched through the fake provider.
    const published = await admin
      .from("posts")
      .select("account_id, media_ig_id")
      .eq("workspace_id", SANDBOX)
      .eq("status", "published")
      .limit(1)
      .single();
    if (published.error) throw published.error;
    const provider = createFakeProvider({ store: createDbFakeStore(admin), now: () => NOW });
    const insights = await provider.getMediaInsights(
      { accountId: published.data.account_id, platformUserId: null, accessToken: "unused" },
      published.data.media_ig_id ?? "",
    );
    expect(insights.views).toBeGreaterThan(0);

    const settings = await admin
      .from("settings")
      .select("timezone, clock_override")
      .eq("workspace_id", SANDBOX)
      .single();
    expect(settings.data?.timezone).toBe("Europe/London");
    expect(new Date(settings.data?.clock_override ?? 0)).toEqual(NOW);

    const failed = await admin
      .from("posts")
      .select("last_error, attempts")
      .eq("workspace_id", SANDBOX)
      .eq("status", "failed");
    expect(failed.data).toHaveLength(1);
    expect(failed.data?.[0]?.attempts).toBe(3);
  });

  it("without ?now= the Sandbox clock runs on real time", async () => {
    const scenario = getScenario("empty");
    if (!scenario) throw new Error("missing empty");
    await loadScenario(admin, scenario);
    const settings = await admin
      .from("settings")
      .select("clock_override")
      .eq("workspace_id", SANDBOX)
      .single();
    expect(settings.data?.clock_override).toBeNull();
    expect(await count("posts", SANDBOX)).toBe(0);
    expect(await count("social_accounts", SANDBOX)).toBe(1);
  });

  it("the Live workspace can't get a fixed clock or fake-provider rows", async () => {
    const clock = await admin
      .from("settings")
      .update({ clock_override: NOW.toISOString() })
      .eq("workspace_id", LIVE);
    expect(clock.error?.code).toBe("23514"); // check_violation

    const account = await admin.from("social_accounts").select("id").eq("brand_id", liveBrandId);
    const fake = await admin
      .from("fake_accounts")
      .insert({ workspace_id: LIVE, account_id: account.data?.[0]?.id ?? "" });
    expect(fake.error?.code).toBe("23514");
  });

  it("the fake provider publishes through its database store", async () => {
    const scenario = getScenario("empty");
    if (!scenario) throw new Error("missing empty");
    await loadScenario(admin, scenario, { fixedNow: NOW });
    const account = await admin
      .from("social_accounts")
      .select("id, platform_user_id")
      .eq("workspace_id", SANDBOX)
      .single();
    if (account.error) throw account.error;
    const ctx = {
      accountId: account.data.id,
      platformUserId: account.data.platform_user_id,
      accessToken: "unused",
    };
    let now = NOW;
    const provider = createFakeProvider({ store: createDbFakeStore(admin), now: () => now });

    const { containerId } = await provider.createReelContainer(ctx, {
      videoUrl: "https://example.invalid/v.mp4",
      caption: "Hello",
    });
    expect(await provider.getContainerStatus(ctx, containerId)).toEqual({ state: "in_progress" });
    expect(await provider.getContainerStatus(ctx, containerId)).toEqual({ state: "finished" });
    const media = await provider.publishContainer(ctx, containerId);
    expect(await provider.publishContainer(ctx, containerId)).toEqual(media);
    expect((await provider.getPublishingQuota(ctx)).used).toBe(1);
    now = new Date(NOW.getTime() + 6 * 3_600_000);
    expect((await provider.getMediaInsights(ctx, media.mediaId)).views).toBeGreaterThan(0);
  });

  it("reset_sandbox is not callable by browser roles", async () => {
    const { error } = await anonClient().rpc("reset_sandbox");
    expect(error).not.toBeNull();
  });
});
