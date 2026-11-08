import { randomBytes } from "node:crypto";
import { delay, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { credentialContext, encryptToken } from "@/lib/crypto/tokens";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { createPublishDue } from "@/lib/scheduler/publish-due";
import { runTick, type TickSummary } from "@/lib/scheduler/tick";
import type { Step } from "@/lib/scheduler/types";
import { FIXTURE_APP, FIXTURE_IG_USER, FIXTURE_TOKENS } from "../fixtures/instagram/handlers";
import { createPublishFixture, type PublishFixture } from "../fixtures/instagram/publish/server";
import { adminClient } from "./helpers";

// BC-16: publishing Instagram posts through the real tick against the local database, with
// Instagram played by the MSW fixture server. Uses a throwaway brand in the Live workspace
// (Instagram accounts can't live in the Sandbox) and removes it afterwards.

const admin = adminClient();
const LIVE = WORKSPACE_IDS.live;
const KEY = randomBytes(32);
const CAPTION = "Day 41 of learning to code (integration)";
const ids = {
  brand: "00000000-0000-4000-8000-00000000b161",
  account: "00000000-0000-4000-8000-00000000a161",
  media: "00000000-0000-4000-8000-00000000c161",
  post: "00000000-0000-4000-8000-00000000d161",
};

// Supabase traffic goes through untouched; only Instagram is answered by the fixture.
const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
});
afterEach(() => {
  server.resetHandlers();
});

let ig: PublishFixture;

function step(): Step {
  return createPublishDue({
    instagram: FIXTURE_APP,
    tokenKey: KEY,
    signVideoUrl: (_db, path) => Promise.resolve(`https://storage.test/videos/${path}?token=s`),
  });
}

const tick = (s: Step = step()) =>
  runTick({ db: admin, workspaceIds: [LIVE], recordHeartbeat: false, steps: [s] });

function total(summaries: TickSummary[], key: string): number {
  return summaries.reduce((n, s) => n + Number(s.steps.publishDue?.[key] ?? 0), 0);
}

async function post() {
  const { data, error } = await admin.from("posts").select("*").eq("id", ids.post).single();
  if (error) throw error;
  return data;
}

async function cleanUp() {
  await admin.from("posts").delete().eq("workspace_id", LIVE).eq("id", ids.post);
  await admin.from("media_assets").delete().eq("workspace_id", LIVE).eq("id", ids.media);
  await admin.from("brands").delete().eq("workspace_id", LIVE).eq("id", ids.brand);
}

async function seed(options: { withToken?: boolean } = {}) {
  await cleanUp();
  const due = new Date(Date.now() - 60_000).toISOString();
  const steps = [
    admin.from("brands").insert({ id: ids.brand, workspace_id: LIVE, name: "BC-16 test brand" }),
    admin.from("social_accounts").insert({
      id: ids.account,
      workspace_id: LIVE,
      brand_id: ids.brand,
      platform: "instagram",
      platform_user_id: FIXTURE_IG_USER.id,
      handle: "codingjourney.bc16",
      slots: ["09:00", "18:00"],
      status: "ready",
    }),
    ...(options.withToken === false
      ? []
      : [
          admin.from("oauth_credentials").insert({
            account_id: ids.account,
            workspace_id: LIVE,
            access_token_enc: encryptToken(
              FIXTURE_TOKENS.long,
              KEY,
              credentialContext(ids.account),
            ),
          }),
        ]),
    admin.from("media_assets").insert({
      id: ids.media,
      workspace_id: LIVE,
      storage_path: `live/bc16/${ids.post}.mp4`,
    }),
    admin.from("posts").insert({
      id: ids.post,
      workspace_id: LIVE,
      account_id: ids.account,
      media_id: ids.media,
      caption: CAPTION,
      timing: "pinned",
      scheduled_at: due,
      status: "queued",
    }),
  ];
  for (const s of steps) {
    const { error } = await s;
    if (error) throw error;
  }
}

/** Puts the post back as it was before a tick, as if that tick crashed before saving. */
async function rollBack(to: Awaited<ReturnType<typeof post>>) {
  const { error } = await admin
    .from("posts")
    .update({
      status: to.status,
      container_id: to.container_id,
      container_created_at: to.container_created_at,
      attempts: to.attempts,
      next_attempt_at: to.next_attempt_at,
      last_error: to.last_error,
      published_at: to.published_at,
      media_ig_id: to.media_ig_id,
      permalink: to.permalink,
      claimed_until: null,
      claim_token: null,
    })
    .eq("id", ids.post);
  if (error) throw error;
}

describe("publishing to Instagram through the tick", () => {
  beforeEach(async () => {
    ig = createPublishFixture({ now: () => new Date() });
    server.use(...ig.handlers);
    await seed();
  });

  afterAll(async () => {
    await cleanUp();
    server.close();
  });

  it("a post can't get two containers, or be published twice, when ticks overlap", async () => {
    // Slow uploads, so the ticks really overlap.
    server.use(
      http.post(`https://graph.facebook.com/:version/${FIXTURE_IG_USER.id}/media`, async () => {
        await delay(400);
        return undefined;
      }),
    );
    const first = await Promise.all([tick(), tick(), tick()]);
    expect(total(first, "claimed")).toBe(1);
    expect(total(first, "uploaded")).toBe(1);
    expect(ig.containers.size).toBe(1);
    let p = await post();
    expect(p.status).toBe("publishing");
    expect(p.container_id).toBe([...ig.containers.keys()][0]);
    expect(p.container_created_at).not.toBeNull();

    const second = await Promise.all([tick(), tick(), tick()]);
    expect(total(second, "published")).toBe(1);
    p = await post();
    expect(p).toMatchObject({
      status: "published",
      media_ig_id: "17950000000000001",
      permalink: "https://www.instagram.com/reel/DFixture0001/",
    });
    expect(ig.calls).toMatchObject({ create: 1, publish: 1 });
    // The quota was checked before uploading and again before publishing.
    expect(ig.calls.quota).toBe(2);
    // Instagram downloaded the video from a signed URL.
    expect([...ig.containers.values()][0]?.videoUrl).toMatch(/^https:\/\/storage\.test\/videos\//);

    // Stats rows are queued with the publish (BC-21 fills them in).
    const metrics = await admin
      .from("post_metrics")
      .select("stat_offset, due_at")
      .eq("post_id", ids.post)
      .order("due_at");
    expect(metrics.data?.map((m) => m.stat_offset)).toEqual(["1h", "6h", "24h", "48h", "7d"]);
    const publishedAt = new Date(p.published_at ?? "").getTime();
    expect(new Date(metrics.data?.[0]?.due_at ?? "").getTime() - publishedAt).toBe(3_600_000);

    const third = await Promise.all([tick(), tick()]);
    expect(total(third, "claimed")).toBe(0);
    expect(ig.calls.publish).toBe(1);
  });

  it("crash after media_publish (before the database write): the next tick doesn't publish again", async () => {
    await tick();
    const before = await post();
    await tick();
    expect((await post()).status).toBe("published");
    await rollBack(before);

    const again = await tick();
    expect(total([again], "published")).toBe(1);
    expect(await post()).toMatchObject({ status: "published", media_ig_id: "17950000000000001" });
    expect(ig.calls.publish).toBe(1);
    expect(ig.media).toHaveLength(1);
  });

  it("crash after creating the container: only the saved container is ever published", async () => {
    const before = await post();
    await tick();
    await rollBack(before);
    await tick();
    await tick();
    expect((await post()).status).toBe("published");
    expect(ig.containers.size).toBe(2);
    expect(ig.calls.publish).toBe(1);
    expect(ig.media).toHaveLength(1);
  });

  it("publish timeout: retried, recovered, published once", async () => {
    await tick();
    ig.loseNextPublishAnswer(2);
    const timedOut = await tick();
    expect(total([timedOut], "retrying")).toBe(1);
    expect((await post()).status).toBe("publishing");
    // The retry waits a minute: bring it forward.
    await admin.from("posts").update({ next_attempt_at: null }).eq("id", ids.post);
    await tick();
    expect(await post()).toMatchObject({ status: "published", media_ig_id: "17950000000000001" });
    expect(ig.calls.publish).toBe(1);
  });

  it("leaves Instagram posts queued when the deployment has no Instagram app", async () => {
    const summary = await tick(createPublishDue({ instagram: null, tokenKey: KEY }));
    expect(summary.steps.publishDue?.claimed).toBe(0);
    expect((await post()).status).toBe("queued");
    expect(ig.calls.quota).toBe(0);
  });

  it("a token TOKEN_ENC_KEY can't open leaves the post and the account alone", async () => {
    const summary = await tick(
      createPublishDue({ instagram: FIXTURE_APP, tokenKey: randomBytes(32) }),
    );
    expect(summary.steps.publishDue).toMatchObject({ claimed: 1, tokenErrors: 1 });
    const p = await post();
    expect(p).toMatchObject({ status: "queued", attempts: 0, claim_token: null });
    const account = await admin
      .from("social_accounts")
      .select("status")
      .eq("id", ids.account)
      .single();
    expect(account.data?.status).toBe("ready");
    expect(ig.calls.quota).toBe(0);
  });

  it("an account without a stored token is paused and flagged", async () => {
    await seed({ withToken: false });
    await tick();
    expect((await post()).status).toBe("paused");
    const account = await admin
      .from("social_accounts")
      .select("status, status_reason")
      .eq("id", ids.account)
      .single();
    expect(account.data?.status).toBe("needs_attention");
    expect(account.data?.status_reason).toMatch(/Reconnect/);
    expect(ig.calls.quota).toBe(0);
  });
});
