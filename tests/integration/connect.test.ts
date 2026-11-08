import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { credentialContext, decryptToken } from "@/lib/crypto/tokens";
import {
  OAUTH_STATE_TTL_MS,
  consumeOAuthState,
  createOAuthState,
  saveConnection,
  type SaveConnectionInput,
} from "@/lib/db/connections";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { connectionStatus, requiredScopes } from "@/lib/domain/connect";
import { fakeUserId } from "@/lib/providers/fake";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { ALLOWED_EMAIL, adminClient, setAllowedEmail, signedInClient } from "./helpers";

// BC-9: saving a connection (reconnect = same account, token encrypted) and the one-time state.

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-06T10:00:00Z");
// A key generated for this run (never a real TOKEN_ENC_KEY).
const KEY = randomBytes(32);

let brandId = "";

beforeEach(async () => {
  const empty = getScenario("empty");
  if (!empty) throw new Error("missing empty scenario");
  await loadScenario(admin, empty, { fixedNow: NOW });
  const brand = await admin.from("brands").select("id").eq("workspace_id", SANDBOX).single();
  if (brand.error) throw brand.error;
  brandId = brand.data.id;
});

function input(overrides: Partial<SaveConnectionInput> = {}): SaveConnectionInput {
  const scopes = requiredScopes("instagram");
  return {
    workspaceId: SANDBOX,
    brandId,
    platform: "instagram",
    profile: {
      platformUserId: "17841400000000001",
      handle: "codingjourney",
      profileUrl: "https://www.instagram.com/codingjourney/",
      followers: 1240,
      accountType: "MEDIA_CREATOR",
    },
    tokens: {
      accessToken: "EAAB-integration-token-1",
      expiresAt: new Date(NOW.getTime() + 60 * 86_400_000),
      platformUserId: "17841400000000001",
      scopes,
    },
    status: connectionStatus({ platform: "instagram", grantedScopes: scopes }),
    key: KEY,
    now: NOW,
    ...overrides,
  };
}

async function accountsFor(platformUserId: string) {
  const { data, error } = await admin
    .from("social_accounts")
    .select("id, handle, followers, status, status_reason, brand_id")
    .eq("workspace_id", SANDBOX)
    .eq("platform_user_id", platformUserId);
  if (error) throw error;
  return data;
}

async function credentials(accountId: string) {
  const { data, error } = await admin
    .from("oauth_credentials")
    .select("*")
    .eq("account_id", accountId)
    .single();
  if (error) throw error;
  return data;
}

describe("saveConnection", () => {
  it("creates a ready account and stores the token encrypted", async () => {
    const saved = await saveConnection(admin, input());
    expect(saved.created).toBe(true);

    const [account, ...more] = await accountsFor("17841400000000001");
    expect(more).toHaveLength(0);
    expect(account).toMatchObject({
      id: saved.accountId,
      handle: "codingjourney",
      followers: 1240,
      status: "ready",
      status_reason: null,
    });

    const creds = await credentials(saved.accountId);
    expect(creds.access_token_enc).not.toContain("EAAB-integration-token-1");
    expect(decryptToken(creds.access_token_enc, KEY, credentialContext(saved.accountId))).toBe(
      "EAAB-integration-token-1",
    );
    expect(creds.scopes).toEqual(requiredScopes("instagram"));
    expect(new Date(creds.expires_at ?? "").getTime()).toBe(NOW.getTime() + 60 * 86_400_000);
  });

  it("reconnecting the same Instagram user updates the existing account", async () => {
    const first = await saveConnection(admin, input());
    // A wait left by the refresh step (a token Facebook won't renew) is cleared by the new token.
    const wait = await admin
      .from("oauth_credentials")
      .update({ refresh_retry_at: new Date(NOW.getTime() + 2 * 86_400_000).toISOString() })
      .eq("account_id", first.accountId);
    if (wait.error) throw wait.error;

    // Reconnect: new token, new follower count, publishing refused this time.
    const scopes = ["instagram_basic", "instagram_manage_insights", "pages_read_engagement"];
    const second = await saveConnection(
      admin,
      input({
        profile: { ...input().profile, handle: "codingjourney.new", followers: 1300 },
        tokens: { ...input().tokens, accessToken: "EAAB-integration-token-2", scopes },
        status: connectionStatus({ platform: "instagram", grantedScopes: scopes }),
      }),
    );

    expect(second).toEqual({ accountId: first.accountId, created: false });
    const accounts = await accountsFor("17841400000000001");
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      handle: "codingjourney.new",
      followers: 1300,
      status: "needs_attention",
      status_reason: "Publishing permission wasn't granted. Reconnect and allow publishing.",
    });
    const creds = await credentials(first.accountId);
    expect(decryptToken(creds.access_token_enc, KEY, credentialContext(first.accountId))).toBe(
      "EAAB-integration-token-2",
    );
    expect(creds.scopes).toEqual(scopes);
    expect(creds.refresh_retry_at).toBeNull();
  });

  it("a fake (Sandbox) connection also gets the fake provider's settings row", async () => {
    const id = fakeUserId("new.creator");
    const scopes = requiredScopes("fake");
    const saved = await saveConnection(
      admin,
      input({
        platform: "fake",
        profile: { platformUserId: id, handle: "new.creator", profileUrl: "x", followers: 700 },
        tokens: { ...input().tokens, platformUserId: id, scopes },
        status: connectionStatus({ platform: "fake", grantedScopes: scopes }),
      }),
    );
    const fake = await admin
      .from("fake_accounts")
      .select("account_id")
      .eq("account_id", saved.accountId);
    expect(fake.data).toHaveLength(1);
  });

  it("refuses a fake account outside the Sandbox", async () => {
    await expect(
      saveConnection(admin, input({ platform: "fake", workspaceId: WORKSPACE_IDS.live })),
    ).rejects.toThrow(/Sandbox/);
  });

  it("the signed-in browser role still can't read the stored token", async () => {
    await saveConnection(admin, input());
    await setAllowedEmail(ALLOWED_EMAIL);
    const browser = await signedInClient(ALLOWED_EMAIL);
    const { data } = await browser.from("oauth_credentials").select("*");
    expect(data ?? []).toHaveLength(0);
    // The account itself is visible to the owner.
    const accounts = await browser
      .from("social_accounts")
      .select("handle")
      .eq("workspace_id", SANDBOX)
      .eq("platform_user_id", "17841400000000001");
    expect(accounts.data).toEqual([{ handle: "codingjourney" }]);
  });
});

describe("oauth states", () => {
  it("works once", async () => {
    const state = randomBytes(16).toString("base64url");
    await createOAuthState(admin, {
      workspaceId: SANDBOX,
      brandId,
      platform: "fake",
      state,
      now: new Date(),
    });
    const first = await consumeOAuthState(admin, state, new Date());
    // The attempt's workspace comes from the row, whatever the dashboard shows now.
    expect(first).toEqual({
      workspaceId: SANDBOX,
      brandId,
      platform: "fake",
      accountId: null,
      expired: false,
    });
    expect(await consumeOAuthState(admin, state, new Date())).toBeNull();
    expect(await consumeOAuthState(admin, "", new Date())).toBeNull();
  });

  it("is reported expired after 10 minutes", async () => {
    const state = randomBytes(16).toString("base64url");
    const start = new Date();
    await createOAuthState(admin, {
      workspaceId: SANDBOX,
      brandId,
      platform: "fake",
      state,
      now: start,
    });
    const later = new Date(start.getTime() + OAUTH_STATE_TTL_MS + 1000);
    expect((await consumeOAuthState(admin, state, later))?.expired).toBe(true);
  });
});
