import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { saveAccountSlots } from "@/lib/db/accounts";
import { QueueEditError, editPost, postNow, removePost } from "@/lib/db/queue-edit";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { stableUuid } from "@/lib/hash";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { ALLOWED_EMAIL, adminClient, setAllowedEmail, signedInClient, type Db } from "./helpers";

// BC-18: editing, posting now and removing waiting posts, and editing slots, as the signed-in
// owner (RLS) on canvas-busy. Writes never race the scheduler's claim.

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");
const ctx = { workspaceId: SANDBOX, timezone: "Europe/London", now: NOW };
const id = (...parts: string[]) => stableUuid("canvas-busy", ...parts);
const CJ = id("account", "cj");
const TRIP = id("account", "trip");

let owner: Db;

async function post(postId: string) {
  const { data, error } = await admin
    .from("posts")
    .select("caption, timing, queue_position, scheduled_at, status")
    .eq("id", postId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

beforeAll(async () => {
  await setAllowedEmail(ALLOWED_EMAIL);
  owner = await signedInClient(ALLOWED_EMAIL);
});

beforeEach(async () => {
  const scenario = getScenario("canvas-busy");
  if (!scenario) throw new Error("canvas-busy missing");
  await loadScenario(admin, scenario, { fixedNow: NOW });
});

describe("removePost", () => {
  it("removes the first queued post; the second moves into its slot; the video goes", async () => {
    const first = await post(id("post", "cj", "q", "0"));
    await expect(removePost(owner, ctx, id("post", "cj", "q", "0"))).resolves.toEqual({
      handle: "codingjourney",
      timing: "queue",
    });
    expect((await post(id("post", "cj", "q", "0")))?.status).toBe("removed");
    expect((await post(id("post", "cj", "q", "1")))?.scheduled_at).toBe(first?.scheduled_at);
    const media = await admin
      .from("media_assets")
      .select("deleted_at")
      .eq("id", id("media", id("post", "cj", "q", "0")))
      .single();
    expect(media.data?.deleted_at).not.toBeNull();
  });

  it("never moves a post that is due or claimed by a tick", async () => {
    // q0 is due (its slot passed a moment ago, the tick hasn't run yet).
    const due = "2026-11-05T22:13:00+00:00";
    await admin
      .from("posts")
      .update({ scheduled_at: due })
      .eq("id", id("post", "cj", "q", "0"));
    await removePost(owner, ctx, id("post", "cj", "q", "3"));
    expect((await post(id("post", "cj", "q", "0")))?.scheduled_at).toBe(due);
  });

  it("refuses a post a tick has claimed", async () => {
    const postId = id("post", "cj", "q", "0");
    await admin
      .from("posts")
      .update({ claimed_until: new Date(Date.now() + 60_000).toISOString() })
      .eq("id", postId);
    const before = await post(postId);
    await expect(removePost(owner, ctx, postId)).rejects.toBeInstanceOf(QueueEditError);
    await expect(
      editPost(owner, ctx, postId, { caption: "x", timing: { kind: "queue" } }),
    ).rejects.toBeInstanceOf(QueueEditError);
    // Nor does re-timing the queue (another post's edit) move it.
    await removePost(owner, ctx, id("post", "cj", "q", "4"));
    expect(await post(postId)).toEqual(before);
  });

  it("refuses a published post", async () => {
    await expect(removePost(owner, ctx, id("post", "cj", "past", "0"))).rejects.toThrow(
      /can't be changed/,
    );
  });
});

describe("editPost", () => {
  it("pins a post; it stays at its time after other queue changes", async () => {
    const postId = id("post", "cj", "q", "2");
    const at = new Date("2026-11-06T16:30:00Z");
    await expect(
      editPost(owner, ctx, postId, { caption: "New caption", timing: { kind: "pinned", at } }),
    ).resolves.toEqual({ timing: "pinned", scheduledAt: at });
    await removePost(owner, ctx, id("post", "cj", "q", "0"));
    expect(await post(postId)).toMatchObject({
      caption: "New caption",
      timing: "pinned",
      queue_position: 2,
      scheduled_at: "2026-11-06T16:30:00+00:00",
    });

    // Back to "Queue slot": it returns to its place in the backlog.
    const back = await editPost(owner, ctx, postId, { caption: "x", timing: { kind: "queue" } });
    expect(back.timing).toBe("queue");
    expect(back.scheduledAt?.toISOString()).toBe("2026-11-06T13:00:00.000Z");
  });

  it("refuses a pinned time in the past", async () => {
    await expect(
      editPost(owner, ctx, id("post", "cj", "q", "0"), {
        caption: "",
        timing: { kind: "pinned", at: new Date(NOW.getTime() - 60_000) },
      }),
    ).rejects.toThrow(/has passed/);
  });
});

describe("postNow", () => {
  it("makes the post due now (pinned) and moves the queue up", async () => {
    const second = await post(id("post", "cj", "q", "1"));
    const first = await post(id("post", "cj", "q", "0"));
    await postNow(owner, ctx, id("post", "cj", "q", "0"));
    expect(await post(id("post", "cj", "q", "0"))).toMatchObject({
      timing: "pinned",
      status: "queued",
      scheduled_at: "2026-11-05T22:14:00+00:00",
    });
    expect((await post(id("post", "cj", "q", "1")))?.scheduled_at).toBe(first?.scheduled_at);
    expect(second?.scheduled_at).not.toBe(first?.scheduled_at);
  });

  it("refuses posts of an account that needs attention", async () => {
    await expect(postNow(owner, ctx, id("post", "tri", "q", "0"))).rejects.toThrow(
      /needs attention/,
    );
  });
});

describe("saveAccountSlots", () => {
  it("saves cleaned slots and re-times the account's queue", async () => {
    const ctx10 = { ...ctx, now: new Date("2026-11-05T10:00:00Z") };
    await expect(
      saveAccountSlots(owner, ctx10, TRIP, ["21:00", "12:00", "18:30"]),
    ).resolves.toEqual({
      handle: "trip.app",
      before: ["12:00", "18:30"],
      slots: ["12:00", "18:30", "21:00"],
    });
    // Removing every slot leaves the queue without times.
    await saveAccountSlots(owner, ctx, CJ, []);
    expect((await post(id("post", "cj", "q", "0")))?.scheduled_at).toBeNull();
  });
});
