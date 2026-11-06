import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import {
  ALL_TABLES,
  ALLOWED_EMAIL,
  OTHER_EMAIL,
  adminClient,
  anonClient,
  deleteUser,
  setAllowedEmail,
  signedInClient,
  type Db,
} from "./helpers";

/** Seeds one row in every table (Sandbox), so "no rows" means RLS hid them, not that none exist. */
async function seedEveryTable(admin: Db) {
  const ws = WORKSPACE_IDS.sandbox;
  const one = async <T>(p: PromiseLike<PostgrestSingleResponse<T>>): Promise<T> => {
    const res = await p;
    if (res.error) throw new Error(res.error.message);
    return res.data;
  };

  const brand = await one(
    admin.from("brands").insert({ workspace_id: ws, name: "RLS brand" }).select("id").single(),
  );
  const account = await one(
    admin
      .from("social_accounts")
      .insert({ workspace_id: ws, brand_id: brand.id, platform: "fake", handle: "rls_account" })
      .select("id")
      .single(),
  );
  const media = await one(
    admin
      .from("media_assets")
      .insert({ workspace_id: ws, storage_path: `rls/${crypto.randomUUID()}.mp4` })
      .select("id")
      .single(),
  );
  const post = await one(
    admin
      .from("posts")
      .insert({ workspace_id: ws, account_id: account.id, media_id: media.id })
      .select("id")
      .single(),
  );
  await one(
    admin
      .from("oauth_credentials")
      .insert({ workspace_id: ws, account_id: account.id, access_token_enc: "enc:secret" })
      .select("account_id")
      .single(),
  );
  await one(
    admin
      .from("oauth_states")
      .insert({
        workspace_id: ws,
        state: crypto.randomUUID(),
        platform: "fake",
        brand_id: brand.id,
      })
      .select("state")
      .single(),
  );
  await one(
    admin
      .from("post_metrics")
      .insert({
        workspace_id: ws,
        post_id: post.id,
        stat_offset: "1h",
        due_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
  );
  await one(
    admin
      .from("account_metrics")
      .insert({ workspace_id: ws, account_id: account.id, day: "2026-11-06", followers: 10 })
      .select("account_id")
      .single(),
  );
  await one(
    admin
      .from("api_keys")
      .insert({ workspace_id: ws, name: "RLS key", key_hash: `hash-${crypto.randomUUID()}` })
      .select("id")
      .single(),
  );
  await one(
    admin
      .from("job_log")
      .insert({ workspace_id: ws, kind: "test", ok: true, post_id: post.id })
      .select("id")
      .single(),
  );
  return { brandId: brand.id, mediaId: media.id };
}

describe("row level security", () => {
  const admin = adminClient();
  let allowed: Db;
  let other: Db;
  let seeded: { brandId: string; mediaId: string };

  beforeAll(async () => {
    await setAllowedEmail(ALLOWED_EMAIL);
    seeded = await seedEveryTable(admin);
    allowed = await signedInClient(ALLOWED_EMAIL);
    other = await signedInClient(OTHER_EMAIL);
  });

  afterAll(async () => {
    // Cascades to accounts, posts, credentials, states, metrics; job_log rows keep a null post.
    await admin.from("brands").delete().eq("id", seeded.brandId);
    await admin.from("media_assets").delete().eq("id", seeded.mediaId);
    await admin.from("api_keys").delete().eq("name", "RLS key");
    await admin.from("job_log").delete().eq("kind", "test");
    await deleteUser(OTHER_EMAIL);
    await setAllowedEmail(null);
  });

  describe("oauth_credentials", () => {
    it("the admin client can select it", async () => {
      const { data, error } = await admin.from("oauth_credentials").select("*");
      expect(error).toBeNull();
      expect(data?.length).toBeGreaterThan(0);
    });

    it("the allowed user's browser client cannot", async () => {
      const { data, error } = await allowed.from("oauth_credentials").select("*");
      expect(error?.code).toBe("42501"); // permission denied
      expect(data).toBeNull();
    });

    it("the anon client cannot", async () => {
      const { data, error } = await anonClient().from("oauth_credentials").select("*");
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });
  });

  describe("the allowed user", () => {
    it("reads the workspaces and every seeded browser table", async () => {
      const workspaces = await allowed.from("workspaces").select("kind");
      expect(workspaces.data).toHaveLength(2);

      for (const table of [
        "brands",
        "social_accounts",
        "oauth_states",
        "media_assets",
        "posts",
        "post_metrics",
        "account_metrics",
        "job_log",
      ] as const) {
        const { data, error } = await allowed.from(table).select("*");
        expect(error, table).toBeNull();
        expect(data?.length, table).toBeGreaterThan(0);
      }
    });

    it("writes rows", async () => {
      const inserted = await allowed
        .from("brands")
        .insert({ workspace_id: WORKSPACE_IDS.sandbox, name: "Written by the allowed user" })
        .select("id")
        .single();
      expect(inserted.error).toBeNull();
      const deleted = await allowed
        .from("brands")
        .delete()
        .eq("id", inserted.data?.id ?? "")
        .select("id");
      expect(deleted.data).toHaveLength(1);
    });

    it("reads api_keys but never key_hash", async () => {
      const visible = await allowed.from("api_keys").select("id, name, last_used_at");
      expect(visible.error).toBeNull();
      expect(visible.data?.length).toBeGreaterThan(0);

      const hash = await allowed.from("api_keys").select("key_hash");
      expect(hash.error?.code).toBe("42501");
      const star = await allowed.from("api_keys").select("*");
      expect(star.error?.code).toBe("42501");
    });

    it("cannot read or change app_settings", async () => {
      const read = await allowed.from("app_settings").select("*");
      expect(read.error?.code).toBe("42501");
      const write = await allowed
        .from("app_settings")
        .update({ allowed_email: OTHER_EMAIL })
        .eq("id", true);
      expect(write.error?.code).toBe("42501");
    });
  });

  describe("a user with another email", () => {
    it.each(ALL_TABLES)("gets no rows from %s", async (table) => {
      const { data } = await other.from(table).select("*");
      // Either RLS filters every row out, or the table/column isn't granted at all.
      expect(data ?? []).toEqual([]);
    });

    it("cannot write", async () => {
      const { error } = await other
        .from("brands")
        .insert({ workspace_id: WORKSPACE_IDS.sandbox, name: "Intruder" });
      expect(error?.code).toBe("42501"); // new row violates row-level security policy
    });
  });

  describe("signed out (anon)", () => {
    it.each(ALL_TABLES)("gets no rows from %s", async (table) => {
      const { data } = await anonClient().from(table).select("*");
      expect(data ?? []).toEqual([]);
    });
  });

  it("nobody but the service role sees anything when no email is allowed", async () => {
    await setAllowedEmail(null);
    const { data } = await allowed.from("workspaces").select("id");
    expect(data).toEqual([]);
    await setAllowedEmail(ALLOWED_EMAIL);
  });
});
