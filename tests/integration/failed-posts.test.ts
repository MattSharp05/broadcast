import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FailedPostError,
  removeFailedPost,
  replaceFailedVideo,
  retryFailedPost,
} from "@/lib/db/failed-posts";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { REPLACE_LOG, RETRY_LOG } from "@/lib/domain/failed-posts";
import { stableUuid } from "@/lib/hash";
import { createPublishDue } from "@/lib/scheduler/publish-due";
import { runTick } from "@/lib/scheduler/tick";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { LOST_CONTAINER } from "@/lib/scenarios/post-failed";
import { ALLOWED_EMAIL, adminClient, setAllowedEmail, signedInClient, type Db } from "./helpers";

// BC-20: a failed post's Retry now, Replace video and Remove, as the signed-in owner (RLS) on the
// post-failed scenario, then the real scheduler tick on the Sandbox (fake provider).

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");
const ctx = { workspaceId: SANDBOX, timezone: "Europe/London", now: NOW };
const id = (...parts: string[]) => stableUuid("post-failed", ...parts);
const ACCOUNT = id("account");
const REJECTED = id("post", "rejected");
const LOST = id("post", "lost");
const NEXT = id("post", "next");

let owner: Db;

async function post(postId: string) {
  const { data, error } = await admin.from("posts").select("*").eq("id", postId).single();
  if (error) throw new Error(error.message);
  return data;
}

async function containers() {
  const { data, error } = await admin
    .from("fake_containers")
    .select("id, published_at")
    .eq("account_id", ACCOUNT);
  if (error) throw new Error(error.message);
  return data;
}

async function logLines(postId: string) {
  const { data, error } = await admin
    .from("job_log")
    .select("message")
    .eq("post_id", postId)
    .order("id");
  if (error) throw new Error(error.message);
  return data.map((l) => l.message);
}

const tick = () =>
  runTick({
    db: admin,
    workspaceIds: [SANDBOX],
    recordHeartbeat: false,
    steps: [createPublishDue({ instagram: null, tokenKey: null })],
  });

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof FailedPostError) return err.code;
    throw err;
  }
  throw new Error("expected a refusal");
}

beforeAll(async () => {
  await setAllowedEmail(ALLOWED_EMAIL);
  owner = await signedInClient(ALLOWED_EMAIL);
});

beforeEach(async () => {
  const scenario = getScenario("post-failed");
  if (!scenario) throw new Error("post-failed missing");
  await loadScenario(admin, scenario, { fixedNow: NOW });
});

describe("Retry now", () => {
  it("recovers a post whose answer was lost: checks the kept container, never posts twice", async () => {
    await retryFailedPost(owner, ctx, LOST);
    const retried = await post(LOST);
    expect(retried).toMatchObject({
      status: "publishing",
      attempts: 0,
      last_error: null,
      container_id: LOST_CONTAINER,
    });
    expect(await logLines(LOST)).toContain(RETRY_LOG);

    await tick();
    const done = await post(LOST);
    expect(done.status).toBe("published");
    expect(done.media_ig_id).toBe("fake_media_post_failed_lost");
    // Still the one container the fake had published: nothing new was uploaded or published.
    const all = await containers();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(LOST_CONTAINER);
  });

  it("makes a rejected post due now; the same video is rejected again", async () => {
    const before = await post(REJECTED);
    await retryFailedPost(owner, ctx, REJECTED);
    const retried = await post(REJECTED);
    expect(retried).toMatchObject({
      status: "queued",
      attempts: 0,
      last_error: null,
      timing: "pinned",
      // Pinned to now; its queue position stays (nothing renumbers the queue).
      queue_position: before.queue_position,
    });
    expect(new Date(retried.scheduled_at ?? "").toISOString()).toBe(NOW.toISOString());
    expect((await post(NEXT)).queue_position).toBe(1);

    await tick(); // uploads
    expect((await post(REJECTED)).status).toBe("publishing");
    await tick(); // the container ends in an error: 1080 × 1350
    const again = await post(REJECTED);
    expect(again.status).toBe("failed");
    expect(again.last_error).toContain("1080 × 1350");
  });

  it("is refused once the post isn't failed", async () => {
    await retryFailedPost(owner, ctx, REJECTED);
    expect(await refusal(retryFailedPost(owner, ctx, REJECTED))).toBe("not_failed");
    expect(await refusal(retryFailedPost(owner, ctx, NEXT))).toBe("not_failed");
  });

  it("is refused while the account needs attention", async () => {
    await admin.from("social_accounts").update({ status: "needs_attention" }).eq("id", ACCOUNT);
    expect(await refusal(retryFailedPost(owner, ctx, REJECTED))).toBe("account_paused");
  });
});

describe("Replace video", () => {
  const media = {
    storagePath: `${SANDBOX}/videos/11111111-1111-4111-8111-111111111111.mp4`,
    thumbnailPath: null,
    durationS: 20,
    width: 1080,
    height: 1920,
    bytes: 5_000_000,
  };

  it("swaps in a 9:16 video, keeps the caption and publishes on the next ticks", async () => {
    const before = await post(REJECTED);
    await replaceFailedVideo(owner, ctx, REJECTED, media);
    const replaced = await post(REJECTED);
    expect(replaced).toMatchObject({
      status: "queued",
      attempts: 0,
      last_error: null,
      caption: before.caption,
      container_id: null,
    });
    expect(replaced.media_id).not.toBe(before.media_id);
    expect(await logLines(REJECTED)).toContain(REPLACE_LOG);
    // The old video isn't used by any other post: it is marked deleted.
    const old = await admin
      .from("media_assets")
      .select("deleted_at")
      .eq("id", before.media_id)
      .single();
    expect(old.data?.deleted_at).not.toBeNull();

    await tick(); // uploads
    await tick(); // the 9:16 video passes and publishes
    expect((await post(REJECTED)).status).toBe("published");
  });

  it("is refused while the post keeps a container (it may be live already)", async () => {
    expect(await refusal(replaceFailedVideo(owner, ctx, LOST, media))).toBe("container_kept");
    expect((await post(LOST)).status).toBe("failed");
  });
});

describe("Remove", () => {
  it("marks the failed post removed", async () => {
    const removed = await removeFailedPost(owner, ctx, REJECTED);
    expect(removed.handle).toBe("failed.posts");
    expect((await post(REJECTED)).status).toBe("removed");
    expect(await refusal(removeFailedPost(owner, ctx, REJECTED))).toBe("not_failed");
  });
});
