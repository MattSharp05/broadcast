import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MoveError, movePost } from "@/lib/db/queue-edit";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { stableUuid } from "@/lib/hash";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { ALLOWED_EMAIL, adminClient, setAllowedEmail, signedInClient, type Db } from "./helpers";

// BC-22: moving a waiting post within its queue and to another account, as the signed-in owner
// (RLS) on canvas-busy, and undoing the move.
//
// At NOW (Thu 22:14 London) @codingjourney (09:00, 13:00, 19:00) has q0 Fri 09:00, q1 Fri 13:00,
// a pin Fri 19:00, q2 Sat 09:00 …; @trip.app (12:00, 18:30) has q0 Fri 12:00, q1 Fri 18:30 and
// open slots from Sat 12:00.

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");
const ctx = { workspaceId: SANDBOX, timezone: "Europe/London", now: NOW };
const id = (...parts: string[]) => stableUuid("canvas-busy", ...parts);
const CJ = id("account", "cj");
const TRIP = id("account", "trip");
const TRI = id("account", "tri");
const Q = (account: string, k: number) => id("post", account, "q", `${k}`);

let owner: Db;

async function post(postId: string) {
  const { data, error } = await admin
    .from("posts")
    .select("account_id, caption, media_id, timing, queue_position, scheduled_at, status")
    .eq("id", postId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

const at = (iso: string) => new Date(iso).toISOString().replace(".000Z", "+00:00");

beforeAll(async () => {
  await setAllowedEmail(ALLOWED_EMAIL);
  owner = await signedInClient(ALLOWED_EMAIL);
});

beforeEach(async () => {
  const scenario = getScenario("canvas-busy");
  if (!scenario) throw new Error("canvas-busy missing");
  await loadScenario(admin, scenario, { fixedNow: NOW });
});

describe("movePost within an account", () => {
  it("reorders the queue and undo restores it", async () => {
    const moved = await movePost(owner, ctx, Q("cj", 0), {
      accountId: CJ,
      placement: { kind: "queue", after: Q("cj", 1) },
    });
    expect(moved.handle).toBe("codingjourney");
    expect(moved.scheduledAt?.toISOString()).toBe("2026-11-06T13:00:00.000Z");
    expect((await post(Q("cj", 1)))?.scheduled_at).toBe(at("2026-11-06T09:00:00Z"));
    expect((await post(Q("cj", 0)))?.scheduled_at).toBe(at("2026-11-06T13:00:00Z"));
    expect((await post(id("post", "cj", "pinned")))?.scheduled_at).toBe(at("2026-11-06T19:00:00Z"));
    expect(moved.undo).toEqual({ accountId: CJ, placement: { kind: "queue", after: null } });

    await movePost(owner, ctx, Q("cj", 0), moved.undo);
    expect((await post(Q("cj", 0)))?.scheduled_at).toBe(at("2026-11-06T09:00:00Z"));
    expect((await post(Q("cj", 1)))?.scheduled_at).toBe(at("2026-11-06T13:00:00Z"));
  });

  it("moves to the front of the queue", async () => {
    const moved = await movePost(owner, ctx, Q("cj", 2), {
      accountId: CJ,
      placement: { kind: "queue", after: null },
    });
    expect(moved.scheduledAt?.toISOString()).toBe("2026-11-06T09:00:00.000Z");
    expect((await post(Q("cj", 0)))?.scheduled_at).toBe(at("2026-11-06T13:00:00Z"));
    expect((await post(Q("cj", 1)))?.scheduled_at).toBe(at("2026-11-07T09:00:00Z"));
  });
});

describe("movePost to another account", () => {
  it("moves the post (same video and caption) into the first open slot; undo puts it back", async () => {
    const before = await post(Q("cj", 0));
    const moved = await movePost(owner, ctx, Q("cj", 0), {
      accountId: TRIP,
      placement: { kind: "slot", at: new Date("2026-11-07T12:00:00Z") },
    });
    expect(moved.handle).toBe("trip.app");
    expect(moved.scheduledAt?.toISOString()).toBe("2026-11-07T12:00:00.000Z");
    const after = await post(Q("cj", 0));
    expect(after).toMatchObject({
      account_id: TRIP,
      caption: before?.caption,
      media_id: before?.media_id,
      timing: "queue",
      status: "queued",
      scheduled_at: at("2026-11-07T12:00:00Z"),
    });
    // @codingjourney's queue moved up.
    expect((await post(Q("cj", 1)))?.scheduled_at).toBe(at("2026-11-06T09:00:00Z"));

    await movePost(owner, ctx, Q("cj", 0), moved.undo);
    expect(await post(Q("cj", 0))).toMatchObject({
      account_id: CJ,
      timing: "queue",
      scheduled_at: at("2026-11-06T09:00:00Z"),
    });
    expect((await post(Q("cj", 1)))?.scheduled_at).toBe(at("2026-11-06T13:00:00Z"));
  });

  it("pins to a later open slot", async () => {
    const moved = await movePost(owner, ctx, Q("cj", 0), {
      accountId: TRIP,
      placement: { kind: "slot", at: new Date("2026-11-07T18:30:00Z") },
    });
    expect(moved.scheduledAt?.toISOString()).toBe("2026-11-07T18:30:00.000Z");
    expect(await post(Q("cj", 0))).toMatchObject({ account_id: TRIP, timing: "pinned" });
  });

  it("moves a pinned post into another queue; undo re-pins it", async () => {
    const pinned = id("post", "cj", "pinned");
    const moved = await movePost(owner, ctx, pinned, {
      accountId: TRIP,
      placement: { kind: "queue", after: Q("trip", 0) },
    });
    expect(moved.scheduledAt?.toISOString()).toBe("2026-11-06T18:30:00.000Z");
    expect((await post(Q("trip", 1)))?.scheduled_at).toBe(at("2026-11-07T12:00:00Z"));
    expect(moved.undo.placement).toEqual({
      kind: "pinned",
      at: new Date("2026-11-06T19:00:00Z"),
    });
    await movePost(owner, ctx, pinned, moved.undo);
    expect(await post(pinned)).toMatchObject({
      account_id: CJ,
      timing: "pinned",
      scheduled_at: at("2026-11-06T19:00:00Z"),
    });
    expect((await post(Q("trip", 1)))?.scheduled_at).toBe(at("2026-11-06T18:30:00Z"));
  });

  it("refuses an account that needs attention, and leaves the post alone", async () => {
    const before = await post(Q("cj", 0));
    await expect(
      movePost(owner, ctx, Q("cj", 0), { accountId: TRI, placement: { kind: "back" } }),
    ).rejects.toMatchObject({ code: "target_not_ready" });
    expect(await post(Q("cj", 0))).toEqual(before);
  });

  it("refuses a post a tick has claimed", async () => {
    await admin
      .from("posts")
      .update({ claimed_until: new Date(Date.now() + 60_000).toISOString() })
      .eq("id", Q("cj", 0));
    const before = await post(Q("cj", 0));
    await expect(
      movePost(owner, ctx, Q("cj", 0), { accountId: TRIP, placement: { kind: "back" } }),
    ).rejects.toBeInstanceOf(MoveError);
    expect(await post(Q("cj", 0))).toEqual(before);
  });

  it("refuses a position whose post has left the queue", async () => {
    await expect(
      movePost(owner, ctx, Q("cj", 0), {
        accountId: TRIP,
        placement: { kind: "queue", after: Q("cj", 3) },
      }),
    ).rejects.toMatchObject({ code: "unknown_position" });
  });
});
