import type { SupabaseClient } from "@supabase/supabase-js";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import type { Database } from "@/lib/db/types";
import {
  FAKE_FAILURE_MODES,
  type FakeAccountState,
  type FakeContainer,
  type FakeFailureMode,
  type FakeStore,
} from "./fake";

type ContainerRow = Database["public"]["Tables"]["fake_containers"]["Row"];

function toContainer(row: ContainerRow): FakeContainer {
  return {
    id: row.id,
    accountId: row.account_id,
    videoUrl: row.video_url,
    caption: row.caption,
    statusChecks: row.status_checks,
    mediaId: row.media_id,
    permalink: row.permalink,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
  };
}

function toFailureMode(value: string | null): FakeFailureMode | null {
  return FAKE_FAILURE_MODES.find((m) => m === value) ?? null;
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Fake provider store: ${what} failed: ${res.error.message}`);
  return res.data;
}

/**
 * The fake provider's state in the database (`fake_accounts`, `fake_containers`), Sandbox only.
 * Needs a service-role client: those tables have no browser access.
 */
export function createDbFakeStore(db: SupabaseClient<Database>): FakeStore {
  const ws = WORKSPACE_IDS.sandbox;
  return {
    async getAccount(accountId) {
      const row = check(
        await db
          .from("fake_accounts")
          .select(
            "account_id, failure_mode, failures_left, ready_after_checks, quota_limit, social_accounts(handle, followers)",
          )
          .eq("workspace_id", ws)
          .eq("account_id", accountId)
          .maybeSingle(),
        "reading the account",
      );
      if (!row) return null;
      const state: FakeAccountState = {
        accountId: row.account_id,
        handle: row.social_accounts.handle,
        followers: row.social_accounts.followers ?? 0,
        failureMode: toFailureMode(row.failure_mode),
        failuresLeft: row.failures_left,
        readyAfterChecks: row.ready_after_checks,
        quotaLimit: row.quota_limit,
      };
      return state;
    },

    async setFailuresLeft(accountId, failuresLeft) {
      check(
        await db
          .from("fake_accounts")
          .update({ failures_left: failuresLeft })
          .eq("workspace_id", ws)
          .eq("account_id", accountId),
        "updating failures_left",
      );
    },

    async getContainer(id) {
      const row = check(
        await db
          .from("fake_containers")
          .select("*")
          .eq("workspace_id", ws)
          .eq("id", id)
          .maybeSingle(),
        "reading a container",
      );
      return row ? toContainer(row) : null;
    },

    async getContainerByMedia(mediaId) {
      const row = check(
        await db
          .from("fake_containers")
          .select("*")
          .eq("workspace_id", ws)
          .eq("media_id", mediaId)
          .maybeSingle(),
        "reading a container by media",
      );
      return row ? toContainer(row) : null;
    },

    async saveContainer(c) {
      check(
        await db.from("fake_containers").upsert({
          id: c.id,
          workspace_id: ws,
          account_id: c.accountId,
          video_url: c.videoUrl,
          caption: c.caption,
          status_checks: c.statusChecks,
          media_id: c.mediaId,
          permalink: c.permalink,
          published_at: c.publishedAt?.toISOString() ?? null,
        }),
        "saving a container",
      );
    },

    async videoSize(videoUrl) {
      // Sandbox posts hand the fake their media's storage path as the video URL.
      const row = check(
        await db
          .from("media_assets")
          .select("width, height")
          .eq("workspace_id", ws)
          .eq("storage_path", videoUrl)
          .limit(1)
          .maybeSingle(),
        "reading the video size",
      );
      return row?.width && row.height ? { width: row.width, height: row.height } : null;
    },

    async countPublishedSince(accountId, since) {
      const res = await db
        .from("fake_containers")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws)
        .eq("account_id", accountId)
        .gte("published_at", since.toISOString());
      if (res.error) throw new Error(`Fake provider store: counting failed: ${res.error.message}`);
      return res.count ?? 0;
    },
  };
}
