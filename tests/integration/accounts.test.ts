import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  NotFoundError,
  createBrand,
  loadAccounts,
  renameBrand,
  saveAccountDescription,
  saveAccountTags,
} from "@/lib/db/accounts";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
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

// BC-10: the Accounts tab's reads and inline edits, as the signed-in user (RLS applies).

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const LIVE = WORKSPACE_IDS.live;
const NOW = new Date("2026-11-05T22:14:00Z");

let owner: Db;
let stranger: Db;

async function accountId(handle: string): Promise<string> {
  const res = await admin
    .from("social_accounts")
    .select("id")
    .eq("workspace_id", SANDBOX)
    .eq("handle", handle)
    .single();
  if (res.error) throw res.error;
  return res.data.id;
}

beforeAll(async () => {
  await setAllowedEmail(ALLOWED_EMAIL);
  owner = await signedInClient(ALLOWED_EMAIL);
  stranger = await signedInClient(OTHER_EMAIL);
});

afterAll(async () => {
  await setAllowedEmail(null);
});

beforeEach(async () => {
  const busy = getScenario("canvas-busy");
  if (!busy) throw new Error("missing canvas-busy");
  await loadScenario(admin, busy, { fixedNow: NOW });
});

describe("loadAccounts", () => {
  it("reads canvas-busy: five brands, five accounts with backlogs and slots", async () => {
    const data = await loadAccounts(owner, SANDBOX);
    expect(data.brands.map((b) => b.name)).toEqual([
      "Coding Journey",
      "Driftship",
      "Explainers",
      "Sport",
      "Trip",
    ]);
    expect(data.accounts).toHaveLength(5);
    const cj = data.accounts.find((a) => a.handle === "codingjourney");
    expect(cj).toMatchObject({
      brand: "Coding Journey",
      slotsPerDay: 3,
      followers: 1240,
      profileUrl: "https://www.instagram.com/codingjourney/",
    });
    expect(cj?.backlog).toBeGreaterThan(0);
    expect(data.accounts.find((a) => a.handle === "tri.weekly")?.status).toBe("needs_attention");
  });

  it("shows nothing to a signed-in stranger (RLS)", async () => {
    const data = await loadAccounts(stranger, SANDBOX);
    expect(data.accounts).toEqual([]);
    expect(data.brands).toEqual([]);
  });
});

describe("inline edits", () => {
  it("saves tags and descriptions", async () => {
    const id = await accountId("trip.app");
    await saveAccountTags(owner, SANDBOX, id, ["App", "Product", "Launch"]);
    await saveAccountDescription(owner, SANDBOX, id, "Trip, the travel planner.");
    const row = await admin
      .from("social_accounts")
      .select("tags, description")
      .eq("id", id)
      .single();
    expect(row.data).toEqual({
      tags: ["App", "Product", "Launch"],
      description: "Trip, the travel planner.",
    });
  });

  it("refuses an account from another workspace", async () => {
    const id = await accountId("trip.app");
    await expect(saveAccountTags(owner, LIVE, id, ["Nope"])).rejects.toBeInstanceOf(NotFoundError);
    const row = await admin.from("social_accounts").select("tags").eq("id", id).single();
    expect(row.data?.tags).toEqual(["App", "Product"]);
  });

  it("refuses a stranger (RLS)", async () => {
    const id = await accountId("trip.app");
    await expect(saveAccountDescription(stranger, SANDBOX, id, "hacked")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("creates and renames brands", async () => {
    const brand = await createBrand(owner, SANDBOX, "Kart Racer");
    expect(brand.name).toBe("Kart Racer");
    await renameBrand(owner, SANDBOX, brand.id, "Kart Racer Game");
    const data = await loadAccounts(owner, SANDBOX);
    expect(data.brands.map((b) => b.name)).toContain("Kart Racer Game");
    await expect(renameBrand(owner, LIVE, brand.id, "Elsewhere")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(createBrand(stranger, SANDBOX, "Nope")).rejects.toThrow();
  });
});
