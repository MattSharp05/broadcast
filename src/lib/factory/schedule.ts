import "server-only";
import { FactoryError, fail, getProduction, type Db } from "@/lib/db/factory";
import { queueContent, replanAccount } from "@/lib/db/posts";
import { UPCOMING_STATUSES } from "@/lib/domain/canvas";
import { postedCaption } from "@/lib/domain/factory/delivery";
import { versionLabel } from "@/lib/domain/factory/versions";
import { whenLabel } from "@/lib/domain/format";
import { nextOpenSlot, type ContentTiming } from "@/lib/domain/content";
import type { PlannerPost } from "@/lib/domain/queue";
import type { EngineContext } from "./engine";
import { getVersion, hasActivePost, logEvent } from "./studio";

/**
 * Assign and schedule (BC-43): a version that is ready to post goes to its video's account as one
 * post, with the pack's caption and hashtags. Only Matthew's click calls this; it never posts.
 */

/** "next": pinned to the account's next free slot now; "queue": the end of the backlog. */
export type ScheduleTiming = { kind: "next" } | { kind: "queue" } | { kind: "pinned"; at: Date };

/** Each account's next free slot (after its backlog), or null without slots. */
export async function openSlotsByAccount(
  db: Db,
  ws: string,
  timezone: string,
  now: Date,
  accounts: readonly { id: string; slots: readonly string[] }[],
): Promise<Map<string, Date | null>> {
  const out = new Map<string, Date | null>();
  if (!accounts.length) return out;
  const { data, error } = await db
    .from("posts")
    .select("id, account_id, timing, queue_position, scheduled_at, status")
    .eq("workspace_id", ws)
    .in(
      "account_id",
      accounts.map((a) => a.id),
    )
    .in("status", [...UPCOMING_STATUSES]);
  if (error) fail("reading the queues", error);
  const byAccount = new Map<string, PlannerPost[]>();
  for (const p of data) {
    const list = byAccount.get(p.account_id) ?? [];
    list.push({
      id: p.id,
      timing: p.timing,
      queuePosition: p.queue_position,
      scheduledAt: p.scheduled_at ? new Date(p.scheduled_at) : null,
      status: p.status,
    });
    byAccount.set(p.account_id, list);
  }
  for (const a of accounts) {
    out.set(
      a.id,
      nextOpenSlot({ slots: a.slots, timezone, now, posts: byAccount.get(a.id) ?? [] }),
    );
  }
  return out;
}

export async function scheduleVersion(
  ctx: EngineContext,
  input: {
    productionId: string;
    versionId: string;
    accountId: string;
    timing: ScheduleTiming;
    timezone: string;
  },
): Promise<{ postId: string; scheduledAt: Date | null; message: string }> {
  const ws = ctx.workspaceId;
  const p = await getProduction(ctx.db, ws, input.productionId);
  if (await hasActivePost(ctx.db, ws, p.post_id)) {
    throw new FactoryError(
      "scheduled",
      "This video is already scheduled. Remove its post first, or remake it for another account.",
    );
  }
  // A render Matthew approved (or a video whose post was removed, which stays "scheduled").
  if (p.status !== "ready" && p.status !== "scheduled") {
    throw new FactoryError("not_ready", "Approve the render before scheduling the video.");
  }
  if (p.account_id && p.account_id !== input.accountId) {
    throw new FactoryError(
      "other_account",
      "One video goes to one account. Remake it for that account instead.",
    );
  }
  const version = await getVersion(ctx.db, ws, input.productionId, input.versionId);
  if (!version.media_id) {
    throw new FactoryError("no_media", `${versionLabel(version.number)} has no video to post.`);
  }
  const pack = await ctx.db
    .from("delivery_packs")
    .select("caption, hashtags, ready_at")
    .eq("workspace_id", ws)
    .eq("version_id", version.id)
    .maybeSingle();
  if (pack.error) fail("reading the pack", pack.error);
  if (!pack.data?.ready_at) {
    throw new FactoryError(
      "not_ready",
      `Mark ${versionLabel(version.number)} ready before scheduling it.`,
    );
  }
  const account = await ctx.db
    .from("social_accounts")
    .select("id, handle, slots")
    .eq("workspace_id", ws)
    .eq("id", input.accountId)
    .maybeSingle();
  if (account.error) fail("reading the account", account.error);
  if (!account.data) throw new FactoryError("not_found", "Unknown account.");

  let timing: ContentTiming;
  if (input.timing.kind === "pinned") timing = input.timing;
  else if (input.timing.kind === "next") {
    const open = (
      await openSlotsByAccount(ctx.db, ws, input.timezone, ctx.now, [account.data])
    ).get(account.data.id);
    // Without slots the post waits in the backlog like any queued video.
    timing = open ? { kind: "pinned", at: open } : { kind: "queue" };
  } else timing = { kind: "queue" };

  const caption = postedCaption(pack.data.caption, pack.data.hashtags);
  const queued = await queueContent(ctx.db, {
    workspaceId: ws,
    timezone: input.timezone,
    now: ctx.now,
    media: null,
    existingMediaId: version.media_id,
    isAiGenerated: p.use_avatar,
    caption,
    accountIds: [account.data.id],
    timing,
  });
  const post = queued.posts[0];
  if (!post) throw new FactoryError("not_queued", "The post wasn't created. Try again.");

  // Only the first click wins: a second one racing this finds post_id set and undoes its post.
  const claim = await ctx.db
    .from("productions")
    .update({
      account_id: account.data.id,
      post_id: post.id,
      media_id: version.media_id,
      caption,
      status: "scheduled",
    })
    .eq("workspace_id", ws)
    .eq("id", p.id)
    .or(p.post_id ? `post_id.is.null,post_id.eq.${p.post_id}` : "post_id.is.null")
    .select("id");
  if (claim.error || !claim.data.length) {
    await ctx.db.from("posts").delete().eq("workspace_id", ws).eq("id", post.id);
    // Its pin may have pushed queued posts back: plan the queue again without it.
    await replanAccount(
      ctx.db,
      { workspaceId: ws, timezone: input.timezone, now: ctx.now },
      account.data.id,
    );
    if (claim.error) fail("saving the schedule", claim.error);
    throw new FactoryError("scheduled", "This video was just scheduled. Reload to see where.");
  }

  const when = post.scheduledAt
    ? whenLabel(post.scheduledAt, ctx.now, input.timezone)
    : "when a slot opens";
  await logEvent(ctx, p.id, {
    actor: "matthew",
    intent: `Scheduled ${versionLabel(version.number)} for @${account.data.handle}, ${when}.`,
  });
  return {
    postId: post.id,
    scheduledAt: post.scheduledAt,
    message: `${versionLabel(version.number)} scheduled for @${account.data.handle}, ${when}.`,
  };
}
