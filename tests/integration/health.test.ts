import { randomBytes } from "node:crypto";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { credentialContext, decryptToken, encryptToken } from "@/lib/crypto/tokens";
import { flagAccount, resumeAccount } from "@/lib/db/health";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { stableUuid } from "@/lib/hash";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { dueSeed } from "@/lib/scenarios/publish-due-now";
import { createPublishDue } from "@/lib/scheduler/publish-due";
import { createRefreshTokens } from "@/lib/scheduler/refresh-tokens";
import { runTick } from "@/lib/scheduler/tick";
import type { Step } from "@/lib/scheduler/types";
import {
  FIXTURE_APP,
  FIXTURE_ME,
  FIXTURE_TOKENS,
  instagramHandlers,
} from "../fixtures/instagram/handlers";
import { createPublishFixture } from "../fixtures/instagram/publish/server";
import { adminClient } from "./helpers";

// BC-19: connection health against the local database. The Sandbox (fake provider) for the
// scenarios; Instagram (MSW fixtures) in a throwaway Live brand for refresh and connection checks.

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const LIVE = WORKSPACE_IDS.live;
const NOW = new Date("2026-11-05T22:14:00Z");
const DAY = 24 * 3_600_000;
const KEY = randomBytes(32);

const tick = (workspace: string, step: Step) =>
  runTick({ db: admin, workspaceIds: [workspace], recordHeartbeat: false, steps: [step] });

async function accountOf(id: string) {
  const { data, error } = await admin
    .from("social_accounts")
    .select("status, status_reason")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

async function postsOf(accountId: string) {
  const { data, error } = await admin
    .from("posts")
    .select("id, status, queue_position, scheduled_at, last_error")
    .eq("account_id", accountId)
    .order("queue_position");
  if (error) throw error;
  return data;
}

async function credentialOf(accountId: string) {
  const { data, error } = await admin
    .from("oauth_credentials")
    .select("*")
    .eq("account_id", accountId)
    .single();
  if (error) throw error;
  return data;
}

describe("Sandbox: auth errors pause the account", () => {
  afterAll(async () => {
    await admin.rpc("reset_sandbox");
  });

  it("an auth error during publish flags the account and pauses its other queued posts", async () => {
    const name = "health-publish-auth";
    await loadScenario(
      admin,
      {
        name,
        description: "test",
        build: ({ now }) => dueSeed({ name, handle: "lost.access", now, failure: "token_expired" }),
      },
      { fixedNow: NOW },
    );
    const accountId = stableUuid(name, "account");
    const before = await postsOf(accountId);
    expect(before.map((p) => p.status)).toEqual(["queued", "queued"]);

    const summary = await tick(SANDBOX, createPublishDue({ instagram: null, tokenKey: KEY }));
    expect(summary.steps.publishDue).toMatchObject({ claimed: 1, paused: 1 });

    expect(await accountOf(accountId)).toMatchObject({ status: "needs_attention" });
    const after = await postsOf(accountId);
    // Both paused (the one that wasn't due yet too), in the same order and at the same times.
    expect(after.map((p) => p.status)).toEqual(["paused", "paused"]);
    expect(after.map((p) => p.queue_position)).toEqual(before.map((p) => p.queue_position));
    expect(after[1]?.scheduled_at).toBe(before[1]?.scheduled_at);

    // Reconnected: the posts go back in the queue, re-timed from now.
    await admin
      .from("social_accounts")
      .update({ status: "ready", status_reason: null })
      .eq("id", accountId);
    const resumed = await resumeAccount(admin, {
      workspaceId: SANDBOX,
      accountId,
      timezone: "Europe/London",
      now: NOW,
    });
    expect(resumed).toBe(2);
    const back = await postsOf(accountId);
    expect(back.map((p) => p.status)).toEqual(["queued", "queued"]);
    expect(back.every((p) => p.last_error === null)).toBe(true);
    // The once-due post now waits for the next free slot instead of a time in the past.
    expect(back.every((p) => p.scheduled_at && new Date(p.scheduled_at) > NOW)).toBe(true);
    expect(back[0]?.queue_position).toBe(0);
    expect(new Date(back[0]?.scheduled_at ?? 0) < new Date(back[1]?.scheduled_at ?? 0)).toBe(true);
  });

  it("token-expiring: one token renews, the refused one flags its account and pauses its posts", async () => {
    const scenario = getScenario("token-expiring");
    if (!scenario) throw new Error("token-expiring is not registered");
    await loadScenario(admin, scenario, { fixedNow: NOW });
    const renews = stableUuid("token-expiring", "account", "renews");
    const revoked = stableUuid("token-expiring", "account", "revoked");
    const step = createRefreshTokens({ instagram: null, tokenKey: KEY });

    const [a, b] = await Promise.all([tick(SANDBOX, step), tick(SANDBOX, step)]);
    const claimed = Number(a.steps.refreshTokens?.claimed) + Number(b.steps.refreshTokens?.claimed);
    expect(claimed).toBe(2);

    const cred = await credentialOf(renews);
    expect(new Date(cred.expires_at ?? 0).getTime()).toBe(NOW.getTime() + 60 * DAY);
    expect(cred.last_refreshed_at && new Date(cred.last_refreshed_at).getTime()).toBe(
      NOW.getTime(),
    );
    expect(cred.refresh_claim_token).toBeNull();
    // The new (fake) token is stored encrypted for this account.
    expect(() => decryptToken(cred.access_token_enc, KEY, credentialContext(renews))).not.toThrow();
    expect(await accountOf(renews)).toMatchObject({ status: "ready" });
    expect((await postsOf(renews)).every((p) => p.status === "queued")).toBe(true);

    expect(await accountOf(revoked)).toMatchObject({
      status: "needs_attention",
      status_reason: "Instagram access expired. Reconnect the account to resume posting.",
    });
    expect((await postsOf(revoked)).map((p) => p.status)).toEqual(["paused", "paused", "paused"]);

    // Nothing is due any more.
    const again = await tick(SANDBOX, step);
    expect(again.steps.refreshTokens).toMatchObject({ claimed: 0 });
  });

  it("flagAccount leaves publishing and published posts alone", async () => {
    const scenario = getScenario("canvas-busy");
    if (!scenario) throw new Error("canvas-busy is not registered");
    await loadScenario(admin, scenario, { fixedNow: NOW });
    const cj = stableUuid("canvas-busy", "account", "cj");
    const before = await postsOf(cj);
    const paused = await flagAccount(admin, {
      workspaceId: SANDBOX,
      accountId: cj,
      reason: "Test reason. Reconnect.",
      kind: "check",
    });
    const after = await postsOf(cj);
    expect(paused).toBe(before.filter((p) => p.status === "queued").length);
    expect(after.filter((p) => p.status === "published").length).toBe(
      before.filter((p) => p.status === "published").length,
    );
    expect(after.some((p) => p.status === "queued")).toBe(false);
  });
});

describe("Instagram: refresh and connection checks (MSW)", () => {
  const ids = {
    brand: stableUuid("bc19", "brand"),
    account: stableUuid("bc19", "account"),
  };
  const server = setupServer();
  beforeAll(() => {
    server.listen({ onUnhandledRequest: "bypass" });
  });
  afterEach(() => {
    server.resetHandlers();
  });
  afterAll(async () => {
    await admin.from("brands").delete().eq("workspace_id", LIVE).eq("id", ids.brand);
    server.close();
  });

  async function seed(token: string, times: { expiresIn: number; refreshedAgo: number }) {
    await admin.from("brands").delete().eq("workspace_id", LIVE).eq("id", ids.brand);
    const steps = [
      admin.from("brands").insert({ id: ids.brand, workspace_id: LIVE, name: "BC-19 test brand" }),
      admin.from("social_accounts").insert({
        id: ids.account,
        workspace_id: LIVE,
        brand_id: ids.brand,
        platform: "instagram",
        platform_user_id: FIXTURE_ME.user_id,
        handle: "codingjourney.bc19",
        status: "ready",
      }),
      admin.from("oauth_credentials").insert({
        account_id: ids.account,
        workspace_id: LIVE,
        access_token_enc: encryptToken(token, KEY, credentialContext(ids.account)),
        expires_at: new Date(Date.now() + times.expiresIn).toISOString(),
        last_refreshed_at: new Date(Date.now() - times.refreshedAgo).toISOString(),
        // Checked just now: only the refresh runs, unless a test clears it.
        checked_at: new Date().toISOString(),
      }),
    ];
    for (const s of steps) {
      const { error } = await s;
      if (error) throw error;
    }
  }

  const step = () => createRefreshTokens({ instagram: FIXTURE_APP, tokenKey: KEY });

  beforeEach(() => {
    server.use(...instagramHandlers, ...createPublishFixture({ now: () => new Date() }).handlers);
  });

  it("refreshes a token that is old enough and expiring, and stores the new one encrypted", async () => {
    await seed(FIXTURE_TOKENS.long, { expiresIn: 5 * DAY, refreshedAgo: 55 * DAY });
    const summary = await tick(LIVE, step());
    expect(summary.steps.refreshTokens).toMatchObject({ claimed: 1, refreshed: 1 });
    const cred = await credentialOf(ids.account);
    expect(decryptToken(cred.access_token_enc, KEY, credentialContext(ids.account))).toBe(
      FIXTURE_TOKENS.refreshed,
    );
    expect(new Date(cred.expires_at ?? 0).getTime()).toBeGreaterThan(Date.now() + 50 * DAY);
  });

  it("leaves a recently refreshed token alone", async () => {
    await seed(FIXTURE_TOKENS.long, { expiresIn: 5 * DAY, refreshedAgo: 3_600_000 });
    const summary = await tick(LIVE, step());
    expect(summary.steps.refreshTokens).toMatchObject({ claimed: 0 });
  });

  it("a refused refresh flags the account Needs attention with the reason", async () => {
    await seed("revoked-token", { expiresIn: 2 * DAY, refreshedAgo: 58 * DAY });
    const summary = await tick(LIVE, step());
    expect(summary.steps.refreshTokens).toMatchObject({ claimed: 1, flagged: 1 });
    const account = await accountOf(ids.account);
    expect(account.status).toBe("needs_attention");
    expect(account.status_reason).toMatch(/Reconnect/);
  });

  it("a revoked token is noticed by the connection check", async () => {
    await seed("revoked-token", { expiresIn: 50 * DAY, refreshedAgo: 10 * DAY });
    await admin
      .from("oauth_credentials")
      .update({ checked_at: null })
      .eq("account_id", ids.account);
    const summary = await tick(LIVE, step());
    expect(summary.steps.refreshTokens).toMatchObject({ claimed: 0, checked: 1, flagged: 1 });
    expect((await accountOf(ids.account)).status).toBe("needs_attention");

    // A working token passes the check and stays ready.
    await seed(FIXTURE_TOKENS.long, { expiresIn: 50 * DAY, refreshedAgo: 10 * DAY });
    await admin
      .from("oauth_credentials")
      .update({ checked_at: null })
      .eq("account_id", ids.account);
    const ok = await tick(LIVE, step());
    expect(ok.steps.refreshTokens).toMatchObject({ checked: 1, flagged: 0 });
    expect((await accountOf(ids.account)).status).toBe("ready");
    // Checked again only after a minute.
    const soon = await tick(LIVE, step());
    expect(soon.steps.refreshTokens).toMatchObject({ checked: 0 });
  });
});
