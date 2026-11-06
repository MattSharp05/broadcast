import type { SupabaseClient } from "@supabase/supabase-js";
import { timeChanges, type ExistingPost } from "@/lib/domain/content";
import type { Database } from "./types";
import { WORKSPACE_IDS } from "./workspaces";

type Db = SupabaseClient<Database>;

/**
 * Connection health writes (BC-19): flagging an account that lost its access, and putting its
 * posts back when it is reconnected. Every query is scoped by workspace_id. The scheduler and the
 * connect callback call these with the service-role client.
 */

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what} failed: ${error.message}`);
}

export interface FlagInput {
  workspaceId: string;
  accountId: string;
  /** What the dashboard shows (the account's status_reason). */
  reason: string;
  /** job_log kind: what noticed it ("publish", "stats", "refresh", "check"). */
  kind: string;
}

/**
 * Marks the account Needs attention and pauses its queued posts. They keep their queue position
 * and time, so they come back in the same order. Posts already uploaded (publishing) are left to
 * the publish step, which pauses them when their next call fails. Returns how many it paused.
 */
export async function flagAccount(db: Db, input: FlagInput): Promise<number> {
  const acc = await db
    .from("social_accounts")
    .update({ status: "needs_attention", status_reason: input.reason })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.accountId)
    .select("status");
  if (acc.error) fail("Flagging the account", acc.error);
  if (acc.data.length === 0) return 0;

  const paused = await db
    .from("posts")
    .update({ status: "paused", next_attempt_at: null, last_error: input.reason })
    .eq("workspace_id", input.workspaceId)
    .eq("account_id", input.accountId)
    .eq("status", "queued")
    .select("id");
  if (paused.error) fail("Pausing the account's posts", paused.error);

  const log = await db.from("job_log").insert({
    workspace_id: input.workspaceId,
    kind: input.kind,
    account_id: input.accountId,
    ok: false,
    message: `Needs attention: ${input.reason}${
      paused.data.length > 0
        ? ` Paused ${paused.data.length} queued post${paused.data.length === 1 ? "" : "s"}.`
        : ""
    }`,
  });
  if (log.error) fail("Writing the activity log", log.error);
  return paused.data.length;
}

export interface ResumeInput {
  workspaceId: string;
  accountId: string;
  /** Workspace timezone and clock, for re-timing the queue. */
  timezone: string;
  now: Date;
}

/**
 * After a successful reconnect: the account's paused posts go back in the queue (same order,
 * retries reset) and the queue is re-timed from now. A pinned post whose time passed while it was
 * paused is due straight away. Returns how many posts it resumed.
 */
export async function resumeAccount(db: Db, input: ResumeInput): Promise<number> {
  const ws = input.workspaceId;
  const account = await db
    .from("social_accounts")
    .select("slots, status")
    .eq("workspace_id", ws)
    .eq("id", input.accountId)
    .maybeSingle();
  if (account.error) fail("Reading the account", account.error);
  if (account.data?.status !== "ready") return 0;

  const resumed = await db
    .from("posts")
    .update({ status: "queued", attempts: 0, next_attempt_at: null, last_error: null })
    .eq("workspace_id", ws)
    .eq("account_id", input.accountId)
    .eq("status", "paused")
    .select("id");
  if (resumed.error) fail("Resuming the account's posts", resumed.error);

  const res = await db
    .from("posts")
    .select("id, timing, queue_position, scheduled_at, status")
    .eq("workspace_id", ws)
    .eq("account_id", input.accountId)
    .in("status", ["queued", "paused", "publishing"]);
  if (res.error) fail("Reading the queue", res.error);
  const posts: ExistingPost[] = res.data.map((p) => ({
    id: p.id,
    timing: p.timing,
    queuePosition: p.queue_position,
    scheduledAt: p.scheduled_at ? new Date(p.scheduled_at) : null,
    status: p.status,
  }));
  const changes = timeChanges({
    slots: account.data.slots,
    timezone: input.timezone,
    now: input.now,
    posts,
  });
  const saved = await Promise.all(
    changes.map((change) =>
      db
        .from("posts")
        .update({ scheduled_at: change.scheduledAt?.toISOString() ?? null })
        .eq("workspace_id", ws)
        .eq("id", change.id),
    ),
  );
  for (const up of saved) if (up.error) fail("Saving the queue times", up.error);
  return resumed.data.length;
}

/**
 * A Sandbox account was reconnected: its fake access works again (an expired-token failure mode
 * ends, like a fresh Instagram token).
 */
export async function clearFakeTokenFailure(db: Db, accountId: string): Promise<void> {
  const { error } = await db
    .from("fake_accounts")
    .update({ failure_mode: null, failures_left: null })
    .eq("workspace_id", WORKSPACE_IDS.sandbox)
    .eq("account_id", accountId)
    .eq("failure_mode", "token_expired");
  if (error) fail("Resetting the Sandbox account", error);
}

/** How many of the workspace's accounts need attention (the rail's line). RLS applies. */
export async function countNeedsAttention(db: Db, workspaceId: string): Promise<number> {
  const { count, error } = await db
    .from("social_accounts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "needs_attention");
  if (error) fail("Counting accounts that need attention", error);
  return count ?? 0;
}
