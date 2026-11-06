import { describe, expect, it } from "vitest";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { adminClient } from "./helpers";

describe("schema (after pnpm db:reset)", () => {
  const admin = adminClient();

  it("has exactly the Live and Sandbox workspaces, with fixed ids", async () => {
    const { data, error } = await admin.from("workspaces").select("id, name, kind").order("name");
    expect(error).toBeNull();
    expect(data).toEqual([
      { id: WORKSPACE_IDS.live, name: "Live", kind: "live" },
      { id: WORKSPACE_IDS.sandbox, name: "Sandbox", kind: "sandbox" },
    ]);
  });

  it("has a settings row per workspace", async () => {
    const { data, error } = await admin.from("settings").select("workspace_id");
    expect(error).toBeNull();
    expect(data?.map((r) => r.workspace_id).sort()).toEqual(
      [WORKSPACE_IDS.live, WORKSPACE_IDS.sandbox].sort(),
    );
  });

  it("keeps child rows in their parent's workspace", async () => {
    const brand = await admin
      .from("brands")
      .insert({ workspace_id: WORKSPACE_IDS.live, name: "Schema test brand" })
      .select("id")
      .single();
    expect(brand.error).toBeNull();
    const brandId = brand.data?.id ?? "";

    const crossed = await admin.from("social_accounts").insert({
      workspace_id: WORKSPACE_IDS.sandbox,
      brand_id: brandId,
      platform: "fake",
      handle: "crossed",
    });
    expect(crossed.error?.code).toBe("23503"); // foreign_key_violation

    await admin.from("brands").delete().eq("id", brandId);
  });

  it("rejects malformed slots and bumps updated_at on update", async () => {
    const brand = await admin
      .from("brands")
      .insert({ workspace_id: WORKSPACE_IDS.sandbox, name: "Slots test brand" })
      .select("id, updated_at")
      .single();
    const brandId = brand.data?.id ?? "";

    for (const slots of [["9:00"], ["09:00,10:00"], ["24:00"]]) {
      const bad = await admin.from("social_accounts").insert({
        workspace_id: WORKSPACE_IDS.sandbox,
        brand_id: brandId,
        platform: "fake",
        handle: "bad-slots",
        slots,
      });
      expect(bad.error?.code, slots.join()).toBe("23514"); // check_violation
    }

    const good = await admin
      .from("social_accounts")
      .insert({
        workspace_id: WORKSPACE_IDS.sandbox,
        brand_id: brandId,
        platform: "fake",
        handle: "good-slots",
        slots: ["09:00", "18:30"],
      })
      .select("id, updated_at")
      .single();
    expect(good.error).toBeNull();

    const updated = await admin
      .from("social_accounts")
      .update({ description: "changed" })
      .eq("id", good.data?.id ?? "")
      .select("updated_at")
      .single();
    expect(new Date(updated.data?.updated_at ?? 0).getTime()).toBeGreaterThan(
      new Date(good.data?.updated_at ?? 0).getTime(),
    );

    await admin.from("brands").delete().eq("id", brandId);
  });
});
