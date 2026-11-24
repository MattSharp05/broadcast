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

const STUDIO_TABLES = [
  "production_versions",
  "review_batches",
  "review_notes",
  "production_events",
  "board_cards",
  "delivery_packs",
] as const;

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
  const productionId = await seedStudio(admin, media.id);
  return { brandId: brand.id, mediaId: media.id, productionId };
}

/** A production with one row in each studio table (BC-34). */
async function seedStudio(admin: Db, mediaId: string): Promise<string> {
  const ws = WORKSPACE_IDS.sandbox;
  const one = async <T>(p: PromiseLike<PostgrestSingleResponse<T>>): Promise<T> => {
    const res = await p;
    if (res.error) throw new Error(res.error.message);
    return res.data;
  };
  const production = await one(
    admin
      .from("productions")
      .insert({ workspace_id: ws, title: "RLS video" })
      .select("id")
      .single(),
  );
  const production_id = production.id;
  const version = await one(
    admin
      .from("production_versions")
      .insert({
        workspace_id: ws,
        production_id,
        number: 1,
        media_id: mediaId,
        git_sha: "abc1234",
        made_by: "render",
      })
      .select("id")
      .single(),
  );
  const batch = await one(
    admin
      .from("review_batches")
      .insert({ workspace_id: ws, production_id, version_id: version.id })
      .select("id")
      .single(),
  );
  await one(
    admin
      .from("review_notes")
      .insert({
        workspace_id: ws,
        production_id,
        version_id: version.id,
        number: 1,
        kind: "region",
        t_s: 2,
        frame: 60,
        box: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 },
        text: "Logo too big",
        status: "sent",
        batch_id: batch.id,
      })
      .select("id")
      .single(),
  );
  await one(
    admin
      .from("production_events")
      .insert({ workspace_id: ws, production_id, actor: "system", intent: "Rendered v1" })
      .select("id")
      .single(),
  );
  await one(
    admin
      .from("board_cards")
      .insert({ workspace_id: ws, production_id, position: 0, text: "Hook", seconds: 3 })
      .select("id")
      .single(),
  );
  await one(
    admin
      .from("delivery_packs")
      .insert({ workspace_id: ws, production_id, version_id: version.id, hashtags: ["moon"] })
      .select("id")
      .single(),
  );
  return production_id;
}

describe("row level security", () => {
  const admin = adminClient();
  let allowed: Db;
  let other: Db;
  let seeded: { brandId: string; mediaId: string; productionId: string };

  beforeAll(async () => {
    await setAllowedEmail(ALLOWED_EMAIL);
    seeded = await seedEveryTable(admin);
    allowed = await signedInClient(ALLOWED_EMAIL);
    other = await signedInClient(OTHER_EMAIL);
  });

  afterAll(async () => {
    // Cascades to accounts, posts, credentials, states, metrics; job_log rows keep a null post.
    await admin.from("brands").delete().eq("id", seeded.brandId);
    // Cascades to every studio table.
    await admin.from("productions").delete().eq("id", seeded.productionId);
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

    it("reads and writes every studio table", async () => {
      const ws = WORKSPACE_IDS.sandbox;
      const production_id = seeded.productionId;
      for (const table of STUDIO_TABLES) {
        const { data, error } = await allowed.from(table).select("*");
        expect(error, table).toBeNull();
        expect(data?.length, table).toBeGreaterThan(0);
      }

      const version = await allowed
        .from("production_versions")
        .insert({
          workspace_id: ws,
          production_id,
          number: 2,
          git_sha: "def5678",
          made_by: "revise",
        })
        .select("id")
        .single();
      expect(version.error).toBeNull();
      const version_id = version.data?.id ?? "";
      const writes = [
        allowed.from("review_batches").insert({ workspace_id: ws, production_id, version_id }),
        allowed.from("review_notes").insert({
          workspace_id: ws,
          production_id,
          version_id,
          number: 1,
          kind: "general",
          text: "Tighter",
        }),
        allowed
          .from("production_events")
          .insert({ workspace_id: ws, production_id, actor: "matthew", intent: "Sent 1 note" }),
        allowed
          .from("board_cards")
          .insert({ workspace_id: ws, production_id, position: 1, text: "Payoff", seconds: 4.5 }),
        allowed.from("delivery_packs").insert({ workspace_id: ws, production_id, version_id }),
      ];
      for (const res of await Promise.all(writes)) expect(res.error).toBeNull();

      // Deleting the version cascades to its batch, notes and pack.
      const deleted = await allowed
        .from("production_versions")
        .delete()
        .eq("id", version_id)
        .select("id");
      expect(deleted.data).toHaveLength(1);
      const notes = await allowed.from("review_notes").select("id").eq("version_id", version_id);
      expect(notes.data).toEqual([]);
    });

    it("can't rewrite a version, only prune it", async () => {
      const { data } = await allowed
        .from("production_versions")
        .select("id")
        .eq("production_id", seeded.productionId)
        .single();
      const id = data?.id ?? "";
      const rewrite = await allowed
        .from("production_versions")
        .update({ intent: "Changed" })
        .eq("id", id);
      expect(rewrite.error?.message).toMatch(/never change after insert/);

      // Facts arrive once, as the render finishes.
      const versions = allowed.from("production_versions");
      const fill = await versions.update({ proxy_path: "v1_720.mp4", bytes: 1000 }).eq("id", id);
      expect(fill.error).toBeNull();
      const refill = await allowed.from("production_versions").update({ bytes: 2000 }).eq("id", id);
      expect(refill.error?.message).toMatch(/bytes is set once/);

      const prune = await allowed
        .from("production_versions")
        .update({ media_id: null, proxy_path: null, pruned_at: new Date().toISOString() })
        .eq("id", id);
      expect(prune.error).toBeNull();
      const restore = await allowed
        .from("production_versions")
        .update({ media_id: seeded.mediaId })
        .eq("id", id);
      expect(restore.error?.message).toMatch(/media_id is set once/);
      const unprune = await allowed
        .from("production_versions")
        .update({ pruned_at: null })
        .eq("id", id);
      expect(unprune.error?.message).toMatch(/pruned once/);
    });

    it("refuses region notes without a box and rows mixing two productions", async () => {
      const ws = WORKSPACE_IDS.sandbox;
      const { data: version } = await allowed
        .from("production_versions")
        .select("id")
        .eq("production_id", seeded.productionId)
        .single();
      const version_id = version?.id ?? "";
      const noBox = await allowed.from("review_notes").insert({
        workspace_id: ws,
        production_id: seeded.productionId,
        version_id,
        number: 9,
        kind: "region",
        t_s: 1,
        frame: 30,
        text: "Where?",
      });
      expect(noBox.error?.code).toBe("23514");

      const other = await allowed
        .from("productions")
        .insert({ workspace_id: ws, title: "Another video" })
        .select("id")
        .single();
      const otherId = other.data?.id ?? "";
      const mixed = await allowed
        .from("review_batches")
        .insert({ workspace_id: ws, production_id: otherId, version_id });
      expect(mixed.error?.code).toBe("23503");
      const fresh = await allowed
        .from("production_versions")
        .insert({
          workspace_id: ws,
          production_id: seeded.productionId,
          number: 3,
          git_sha: "0123abc",
          made_by: "import",
        })
        .select("id")
        .single();
      const pack = await allowed
        .from("delivery_packs")
        .insert({ workspace_id: ws, production_id: otherId, version_id: fresh.data?.id ?? "" });
      expect(pack.error?.code).toBe("23503");
      await allowed.from("productions").delete().eq("id", otherId);
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
