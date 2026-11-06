import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/db/accounts";
import { loadConnectedAccount, saveAccountSetup } from "@/lib/db/add-account";
import { saveConnection } from "@/lib/db/connections";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { connectionStatus } from "@/lib/domain/connect";
import { createFakeProvider, fakeUserId } from "@/lib/providers/fake";
import { createDbFakeStore } from "@/lib/providers/fake-store";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import {
  ALLOWED_EMAIL,
  OTHER_EMAIL,
  adminClient,
  setAllowedEmail,
  signedInClient,
  type Db,
} from "./helpers";

// BC-13: what the Add account wizard reads after connecting and what Finish saves.

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");
const KEY = randomBytes(32);
let owner: Db;
let stranger: Db;
let accountId = "";

async function connect(handle: string, scopes: string[]): Promise<string> {
  const brand = await admin.from("brands").select("id").eq("workspace_id", SANDBOX).single();
  if (brand.error) throw brand.error;
  const saved = await saveConnection(admin, {
    workspaceId: SANDBOX,
    brandId: brand.data.id,
    platform: "fake",
    profile: {
      platformUserId: fakeUserId(handle),
      handle,
      profileUrl: `https://fake.example/${handle}`,
      followers: 0,
    },
    tokens: {
      accessToken: "fake-token",
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      platformUserId: fakeUserId(handle),
      scopes,
    },
    status: connectionStatus({ platform: "fake", grantedScopes: scopes }),
    key: KEY,
    now: NOW,
  });
  return saved.accountId;
}

const deps = () => ({
  admin,
  quota: (a: { id: string; platformUserId: string | null }) =>
    Promise.resolve({
      provider: createFakeProvider({ store: createDbFakeStore(admin), now: () => NOW }),
      account: { accountId: a.id, platformUserId: a.platformUserId, accessToken: "" },
    }),
});

beforeAll(async () => {
  await setAllowedEmail(ALLOWED_EMAIL);
  owner = await signedInClient(ALLOWED_EMAIL);
  stranger = await signedInClient(OTHER_EMAIL);
});

afterAll(async () => {
  await setAllowedEmail(null);
});

beforeEach(async () => {
  const empty = getScenario("empty");
  if (!empty) throw new Error("missing empty scenario");
  await loadScenario(admin, empty, { fixedNow: NOW });
  accountId = await connect("kartracer.dev", [
    "fake_basic",
    "fake_content_publish",
    "fake_insights",
  ]);
});

describe("loadConnectedAccount", () => {
  it("reads the account, every permission and the daily posts used", async () => {
    const acc = await loadConnectedAccount(owner, SANDBOX, accountId, deps());
    expect(acc).toMatchObject({
      id: accountId,
      handle: "kartracer.dev",
      status: "ready",
      quota: { used: 0, limit: 100 },
      slots: [],
    });
    expect(acc.permissions.map((p) => [p.key, p.granted])).toEqual([
      ["profile", true],
      ["publishing", true],
      ["insights", true],
    ]);
    // The wizard never receives a token.
    expect(JSON.stringify(acc)).not.toContain("fake-token");
  });

  it("shows which permission is missing", async () => {
    const id = await connect("half.allowed", ["fake_basic", "fake_insights"]);
    const acc = await loadConnectedAccount(owner, SANDBOX, id, deps());
    expect(acc.status).toBe("needs_attention");
    expect(acc.permissions.find((p) => p.key === "publishing")?.granted).toBe(false);
  });

  it("refuses an account outside the workspace, or for someone else", async () => {
    await expect(
      loadConnectedAccount(owner, WORKSPACE_IDS.live, accountId, deps()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(loadConnectedAccount(stranger, SANDBOX, accountId, deps())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("saveAccountSetup", () => {
  const setup = {
    tags: ["Racing"],
    description: "Kart racing clips.",
    slots: ["09:00", "12:30"],
    vaultUrl: "https://vault.bitwarden.com/#/vault?itemId=x",
  };

  it("saves tags, description, slots and the vault link", async () => {
    expect(await saveAccountSetup(owner, SANDBOX, accountId, setup)).toEqual({
      handle: "kartracer.dev",
    });
    const row = await admin
      .from("social_accounts")
      .select("tags, description, slots, vault_url")
      .eq("id", accountId)
      .single();
    expect(row.data).toEqual({
      tags: ["Racing"],
      description: "Kart racing clips.",
      slots: ["09:00", "12:30"],
      vault_url: "https://vault.bitwarden.com/#/vault?itemId=x",
    });
  });

  it("only touches the given workspace, and only for the owner", async () => {
    await expect(
      saveAccountSetup(owner, WORKSPACE_IDS.live, accountId, setup),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveAccountSetup(stranger, SANDBOX, accountId, setup)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("refuses slots that aren't HH:MM (database check)", async () => {
    await expect(
      saveAccountSetup(owner, SANDBOX, accountId, { ...setup, slots: ["9am"] }),
    ).rejects.toThrow(/Saving the account failed/);
  });
});
