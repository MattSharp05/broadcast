import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as briefGet } from "@/app/api/routines/[id]/brief/route";
import { POST as planPost } from "@/app/api/routines/[id]/plan/route";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { mintFactoryToken, mintRoutineToken } from "@/lib/factory/tokens";
import { stableUuid } from "@/lib/hash";
import { advanceRoutine, approveSlot } from "@/lib/routines/builder";
import { approvePlan, startPlanning } from "@/lib/routines/planner";
import { getSlots, saveRoutine } from "@/lib/routines/store";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { ROUTINE_CONFIG } from "@/lib/scenarios/routines";
import { adminClient } from "./helpers";

// ADR 0009: routines against the local stack. The Sandbox's fake planner and fake runner plan and
// build at once, so a whole routine runs here without sessions.

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");
const ctx = { db: admin, workspaceId: SANDBOX, now: NOW, timezone: "Europe/London" };

async function load(name: string) {
  const s = getScenario(name);
  if (!s) throw new Error(name);
  await loadScenario(admin, s, { fixedNow: NOW });
}

const routineId = (scenario: string) => stableUuid(scenario, "routine", "weekend");

function call<P>(
  handler: (r: NextRequest, c: { params: Promise<P> }) => Promise<Response>,
  params: P,
  token: string | null,
  body?: unknown,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return handler(
    new NextRequest("http://localhost/api/x", {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  );
}

describe("routines", () => {
  beforeEach(async () => {
    await load("routine-template");
  });

  it("saves a routine and lays out its posting schedule", async () => {
    const accounts = await admin.from("social_accounts").select("id").eq("workspace_id", SANDBOX);
    const id = await saveRoutine(ctx, null, {
      name: "Two days",
      templateId: null,
      startsAt: new Date("2026-11-07T00:00:00Z"),
      endsAt: new Date("2026-11-09T00:00:00Z"),
      postsPerDay: 10,
      windowStart: "09:00",
      windowEnd: "19:00",
      leadMinutes: 180,
      maxParallel: 3,
      approval: "auto",
      budgetUsd: null,
      tags: ["Trip"],
      accountIds: (accounts.data ?? []).map((a) => a.id),
      config: ROUTINE_CONFIG,
    });
    const slots = await getSlots(admin, SANDBOX, id);
    expect(slots).toHaveLength(2 * 2 * 10);
    expect(slots.every((s) => s.status === "open")).toBe(true);
    expect(slots[0]?.postAt.toISOString()).toBe("2026-11-07T09:00:00.000Z");
  });

  it("plans in the Sandbox at once, with no repeats", async () => {
    await load("routine-draft");
    const id = routineId("routine-draft");
    expect((await startPlanning(ctx, id)).kind).toBe("fake");
    const slots = await getSlots(admin, SANDBOX, id);
    expect(slots.every((s) => s.status === "planned" && s.brief)).toBe(true);
    const voices = new Set(slots.map((s) => s.brief?.voiceKey));
    expect(voices).toEqual(new Set(["design-m2", "r3-f03"]));
    const r = await admin.from("routines").select("status").eq("id", id).single();
    expect(r.data?.status).toBe("planned");
  });

  it("builds due slots after approval, then waits for review, then schedules", async () => {
    await load("routine-planned");
    const id = routineId("routine-planned");
    await approvePlan(ctx, id);
    const counts = await advanceRoutine(ctx, id);
    expect(counts.started).toBe(2);
    expect(counts.review).toBe(2);
    const slots = await getSlots(admin, SANDBOX, id);
    const review = slots.filter((s) => s.status === "review");
    expect(review).toHaveLength(2);
    // Each video: one account, the routine's tags and genre, every step approved on autopilot.
    const first = review[0];
    if (!first?.productionId) throw new Error("no production");
    const p = await admin.from("productions").select("*").eq("id", first.productionId).single();
    expect(p.data).toMatchObject({
      status: "ready",
      routine_id: id,
      run_mode: "one_session",
      tags: ["Weekend test"],
      genre: first.brief?.genre,
    });
    const pack = await admin
      .from("delivery_packs")
      .select("ready_at, caption")
      .eq("production_id", first.productionId)
      .single();
    expect(pack.data?.ready_at).not.toBeNull();

    await approveSlot(ctx, first.id);
    const after = (await getSlots(admin, SANDBOX, id)).find((s) => s.id === first.id);
    expect(after?.status).toBe("scheduled");
    const post = await admin
      .from("posts")
      .select("status, scheduled_at, timing")
      .eq("id", after?.postId ?? "")
      .single();
    expect(post.data).toMatchObject({ status: "queued", timing: "pinned" });
    expect(post.data?.scheduled_at).toBe(first.postAt.toISOString().replace(".000Z", "+00:00"));
  });

  it("schedules on its own when approval is automatic, and records missed slots", async () => {
    await load("routine-running");
    const id = routineId("routine-running");
    const counts = await advanceRoutine(ctx, id);
    expect(counts.scheduled).toBe(2);
    const slots = await getSlots(admin, SANDBOX, id);
    expect(slots.filter((s) => s.status === "scheduled")).toHaveLength(2);
    // Never two posts for one slot: running again starts nothing new until capacity frees up.
    const again = await advanceRoutine(ctx, id);
    expect(again.started ?? 0).toBe(0);
    expect(again.scheduled ?? 0).toBe(0);
    const posts = await admin
      .from("posts")
      .select("id")
      .eq("workspace_id", SANDBOX)
      .neq("status", "removed");
    const scheduledSlots = (await getSlots(admin, SANDBOX, id)).filter(
      (s) => s.status === "scheduled",
    );
    expect(posts.data?.length).toBe(scheduledSlots.length);
    expect(new Set(scheduledSlots.map((s) => s.postId)).size).toBe(scheduledSlots.length);
  });

  it("pauses when the budget is spent", async () => {
    await load("routine-running");
    const id = routineId("routine-running");
    await admin.from("routines").update({ budget_usd: 0 }).eq("id", id);
    const counts = await advanceRoutine(ctx, id);
    expect(counts.paused_budget).toBe(1);
    const r = await admin.from("routines").select("status, plan_message").eq("id", id).single();
    expect(r.data?.status).toBe("paused");
  });
});

describe("planner API", () => {
  beforeEach(async () => {
    await load("routine-draft");
  });

  it("refuses a video's token and another routine's", async () => {
    const id = routineId("routine-draft");
    expect((await call(briefGet, { id }, null)).status).toBe(401);
    const p = await admin
      .from("productions")
      .insert({ workspace_id: SANDBOX, idea: "x" })
      .select("id")
      .single();
    const videoToken = await mintFactoryToken(ctx, p.data?.id ?? "");
    expect((await call(briefGet, { id }, videoToken)).status).toBe(401);
    const token = await mintRoutineToken(ctx, id);
    expect((await call(briefGet, { id: stableUuid("other") }, token)).status).toBe(403);
  });

  it("gives the brief, rejects a plan with problems, and saves a good one", async () => {
    const id = routineId("routine-draft");
    const token = await mintRoutineToken(ctx, id);
    const res = await call(briefGet, { id }, token);
    expect(res.status).toBe(200);
    const brief = (await res.json()) as {
      slots: { id: string }[];
      allowed: { voices: { key: string }[] };
      routine: { genre_targets: Record<string, number> };
    };
    expect(brief.allowed.voices.map((v) => v.key)).toEqual(["design-m2", "r3-f03"]);
    expect(Object.values(brief.routine.genre_targets).reduce((a, b) => a + b, 0)).toBe(
      brief.slots.length,
    );

    // Every idea in its own words (the planner refuses near-repeats).
    const word = (i: number, k: number) =>
      `${"bcdfghjklmnpqrstvwxz"[i % 20] ?? "b"}${"aeiou"[k] ?? "a"}${String.fromCharCode(97 + (i % 26))}${i}`;
    const good = brief.slots.map((s, i) => ({
      slot_id: s.id,
      title: `${word(i, 0)} ${word(i, 1)}`,
      idea: `${word(i, 2)} ${word(i, 3)} ${word(i, 4)} ${word(i, 0)}x ${word(i, 1)}y`,
      genre: i % 2 ? "brainteaser" : "explainer",
      hook: "Can you solve it?",
      style: "handmade-2d",
      voice_key: "design-m2",
      music_key: "wallpaper",
    }));
    const bad = [...good];
    bad[0] = { ...good[0], voice_key: "r3-m02" } as (typeof good)[number];
    bad.pop();
    const refused = await call(planPost, { id }, token, { slots: bad });
    expect(refused.status).toBe(422);
    const body = (await refused.json()) as { issues: { message: string }[] };
    expect(body.issues.map((i) => i.message).join(" ")).toMatch(/isn't allowed[\s\S]*no brief/);

    const ok = await call(planPost, { id }, token, { slots: good });
    expect(ok.status).toBe(200);
    const slots = await getSlots(admin, SANDBOX, id);
    expect(slots.every((s) => s.status === "planned")).toBe(true);
  });
});
