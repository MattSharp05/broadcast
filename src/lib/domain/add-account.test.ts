import { describe, expect, it } from "vitest";
import {
  NEW_BRAND,
  SLOTS_MAX,
  addSlot,
  addedMessage,
  cleanSlots,
  cleanUsername,
  cleanVaultUrl,
  emptyDraft,
  parseDraft,
  permissionChecks,
  stepComplete,
  type ConnectedAccount,
  type WizardDraft,
} from "./add-account";

const BRANDS = [{ id: "b1" }, { id: "b2" }];

function draft(over: Partial<WizardDraft> = {}): WizardDraft {
  return { ...emptyDraft(BRANDS), ...over };
}

function account(over: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id: "acc",
    handle: "kartracer.dev",
    platform: "fake",
    brandId: "b1",
    status: "ready",
    statusReason: null,
    followers: 0,
    permissions: permissionChecks("fake", ["fake_basic", "fake_content_publish", "fake_insights"]),
    quota: { used: 0, limit: 100 },
    tags: [],
    description: "",
    slots: [],
    ...over,
  };
}

describe("emptyDraft", () => {
  it("starts on the first brand with the default slots, or on a new brand when there is none", () => {
    expect(emptyDraft(BRANDS)).toMatchObject({ step: 0, brandId: "b1", slots: ["09:00", "18:00"] });
    expect(emptyDraft([]).brandId).toBe(NEW_BRAND);
  });

  it("has no password field", () => {
    expect(Object.keys(emptyDraft(BRANDS)).some((k) => /pass/i.test(k))).toBe(false);
  });
});

describe("cleanUsername", () => {
  it("drops the @ and spaces, and accepts Instagram's characters", () => {
    expect(cleanUsername(" @kartracer.dev ")).toBe("kartracer.dev");
    expect(cleanUsername("a_b.c9")).toBe("a_b.c9");
  });
  it("refuses empty, spaces inside, other characters and more than 30", () => {
    expect(cleanUsername("")).toBeNull();
    expect(cleanUsername("kart racer")).toBeNull();
    expect(cleanUsername("kart-racer")).toBeNull();
    expect(cleanUsername("a".repeat(31))).toBeNull();
  });
});

describe("cleanVaultUrl", () => {
  it("is optional", () => {
    expect(cleanVaultUrl("  ")).toEqual({ valid: true, url: null });
  });
  it("keeps https links", () => {
    expect(cleanVaultUrl(" https://vault.bitwarden.com/#/vault?itemId=abc ")).toEqual({
      valid: true,
      url: "https://vault.bitwarden.com/#/vault?itemId=abc",
    });
  });
  it("refuses anything that isn't an https link", () => {
    for (const bad of ["javascript:alert(1)", "http://vault.example", "vault.bitwarden.com", "x"]) {
      expect(cleanVaultUrl(bad).valid, bad).toBe(false);
    }
    expect(cleanVaultUrl(`https://a.b/${"x".repeat(2000)}`).valid).toBe(false);
  });
});

describe("slots", () => {
  it("cleanSlots keeps valid times, sorted, without duplicates", () => {
    expect(cleanSlots(["18:00", "09:00", "9:00", "25:00", "09:00", " 07:30 "])).toEqual([
      "07:30",
      "09:00",
      "18:00",
    ]);
  });
  it("cleanSlots stops at SLOTS_MAX", () => {
    const many = Array.from(
      { length: 30 },
      (_, i) => `${String(i % 24).padStart(2, "0")}:${i < 24 ? "00" : "30"}`,
    );
    expect(cleanSlots(many)).toHaveLength(SLOTS_MAX);
  });
  it("addSlot adds in order and refuses duplicates and non-times", () => {
    expect(addSlot(["09:00", "18:00"], "12:30")).toEqual(["09:00", "12:30", "18:00"]);
    expect(addSlot(["09:00"], "09:00")).toBeNull();
    expect(addSlot(["09:00"], "")).toBeNull();
    expect(addSlot(["09:00"], "noon")).toBeNull();
  });
  it("addSlot refuses when the account has SLOTS_MAX slots", () => {
    const full = Array.from({ length: SLOTS_MAX }, (_, i) => `${String(i).padStart(2, "0")}:00`);
    expect(addSlot(full, "12:30")).toBeNull();
  });
});

describe("permissionChecks", () => {
  it("lists profile, publishing and insights with what was granted", () => {
    expect(permissionChecks("fake", ["fake_basic", "fake_insights"])).toEqual([
      { key: "profile", label: "Read profile", granted: true },
      { key: "publishing", label: "Publish content", granted: false },
      { key: "insights", label: "Read insights", granted: true },
    ]);
  });
  it("reads Instagram's scope names for Instagram accounts", () => {
    const checks = permissionChecks("instagram", [
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_insights",
    ]);
    expect(checks.every((c) => c.granted)).toBe(true);
    expect(permissionChecks("instagram", ["fake_basic"]).some((c) => c.granted)).toBe(false);
  });
});

describe("stepComplete", () => {
  it("step 1: an existing brand, or a new one with a name", () => {
    expect(stepComplete(draft(), 0, null)).toBe(true);
    expect(stepComplete(draft({ brandId: NEW_BRAND }), 0, null)).toBe(false);
    expect(stepComplete(draft({ brandId: NEW_BRAND, newBrand: "Kart Racer" }), 0, null)).toBe(true);
  });

  it("step 2: a valid username and all three boxes", () => {
    const all = { verified: true, creator: true, tester: true };
    expect(stepComplete(draft({ username: "kartracer.dev" }), 1, null)).toBe(false);
    expect(
      stepComplete(
        draft({ username: "kartracer.dev", checks: { ...all, tester: false } }),
        1,
        null,
      ),
    ).toBe(false);
    expect(stepComplete(draft({ username: "", checks: all }), 1, null)).toBe(false);
    expect(stepComplete(draft({ username: "kart racer", checks: all }), 1, null)).toBe(false);
    expect(stepComplete(draft({ username: "kartracer.dev", checks: all }), 1, null)).toBe(true);
  });

  it("step 3: the vault link is optional but must be https when given", () => {
    expect(stepComplete(draft(), 2, null)).toBe(true);
    expect(stepComplete(draft({ vaultUrl: "javascript:alert(1)" }), 2, null)).toBe(false);
    expect(stepComplete(draft({ vaultUrl: "https://vault.bitwarden.com/x" }), 2, null)).toBe(true);
  });

  it("step 4: a connected account that is ready with every permission", () => {
    const d = draft({ accountId: "acc" });
    expect(stepComplete(d, 3, null)).toBe(false);
    expect(stepComplete(d, 3, account())).toBe(true);
    expect(stepComplete(draft({ accountId: "other" }), 3, account())).toBe(false);
    expect(
      stepComplete(
        d,
        3,
        account({
          status: "needs_attention",
          permissions: permissionChecks("fake", ["fake_basic", "fake_insights"]),
        }),
      ),
    ).toBe(false);
    expect(stepComplete(d, 3, account({ status: "needs_attention" }))).toBe(false);
  });

  it("step 5: at least one slot", () => {
    expect(stepComplete(draft({ accountId: "acc" }), 4, account())).toBe(true);
    expect(stepComplete(draft({ accountId: "acc", slots: [] }), 4, account())).toBe(false);
    expect(stepComplete(draft({ accountId: null }), 4, null)).toBe(false);
  });
});

describe("addedMessage", () => {
  it("echoes the handle and the slots", () => {
    expect(addedMessage("kartracer.dev", 2)).toBe("@kartracer.dev added with 2 open slots a day.");
    expect(addedMessage("a", 1)).toBe("@a added with 1 open slot a day.");
  });
});

describe("parseDraft", () => {
  it("reads back a saved draft", () => {
    const saved = draft({
      step: 2,
      username: "kartracer.dev",
      checks: { verified: true, creator: true, tester: true },
      vaultUrl: "https://vault.bitwarden.com/x",
      tags: ["Tech"],
    });
    expect(parseDraft(JSON.stringify(saved), BRANDS)).toEqual(saved);
  });

  it("returns null for nothing or junk", () => {
    expect(parseDraft(null, BRANDS)).toBeNull();
    expect(parseDraft("{", BRANDS)).toBeNull();
    expect(parseDraft("[1]", BRANDS)).toBeNull();
  });

  it("falls back field by field and never resumes past an incomplete step", () => {
    const parsed = parseDraft(
      JSON.stringify({ step: 4, brandId: "gone", username: "x y", tags: "Tech", slots: [1] }),
      BRANDS,
    );
    expect(parsed).toMatchObject({ step: 1, brandId: "b1", tags: [], slots: [] });
  });

  it("goes back to Connect when step 5 has no account", () => {
    const d = draft({
      step: 4,
      username: "ok",
      checks: { verified: true, creator: true, tester: true },
    });
    expect(parseDraft(JSON.stringify(d), BRANDS)?.step).toBe(3);
  });
});
