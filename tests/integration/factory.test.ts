import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { getProduction, getSteps, spendSoFar } from "@/lib/db/factory";
import {
  approveStep,
  createProduction,
  requestRework,
  startProduction,
  type EngineContext,
} from "@/lib/factory/engine";
import { GenError, listGenKeys, saveGenKey, submitFaceJob, testGenKey } from "@/lib/factory/gen";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { stableUuid } from "@/lib/hash";
import { adminClient } from "./helpers";

// A key generated for this run (never a real TOKEN_ENC_KEY).
process.env.TOKEN_ENC_KEY = randomBytes(32).toString("base64");

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");
const ctx: EngineContext = { db: admin, workspaceId: SANDBOX, now: NOW };
const gen = { db: admin, workspaceId: SANDBOX, sandbox: true, now: NOW };

async function load(name: string) {
  const scenario = getScenario(name);
  if (!scenario) throw new Error(`no scenario ${name}`);
  await loadScenario(admin, scenario, { fixedNow: NOW });
}

async function statuses(id: string) {
  return Object.fromEntries((await getSteps(admin, SANDBOX, id)).map((s) => [s.step, s.status]));
}

describe("Content Factory with the fake runner", () => {
  beforeEach(async () => {
    await load("factory-new");
  });

  it("walks a free video from the idea to a render with a recipe, waiting for approval at each step", async () => {
    const id = await createProduction(ctx, { idea: "How the moon causes tides" });
    await expect(startProduction(ctx, id)).rejects.toThrow(/Pick a style/);
    await admin
      .from("productions")
      .update({ style: "realistic-3d", voice_key: "design-m2", music_key: "floating-cities" })
      .eq("id", id);

    expect(await startProduction(ctx, id)).toEqual({ kind: "fake" });
    expect(await statuses(id)).toMatchObject({ idea: "waiting", script: "pending" });
    expect((await getProduction(admin, SANDBOX, id)).status).toBe("waiting");

    for (const step of ["idea", "script", "style", "visuals", "render"] as const) {
      await approveStep(ctx, id, step);
    }
    const p = await getProduction(admin, SANDBOX, id);
    expect(p.status).toBe("ready");
    expect(p.media_id).toBeTruthy();
    expect(p.caption).toContain('"Floating Cities" by Kevin MacLeod');
    const media = await admin
      .from("media_assets")
      .select("recipe")
      .eq("id", p.media_id ?? "")
      .single();
    expect(media.data?.recipe).toMatchObject({
      style: "realistic-3d",
      voice: "design-m2",
      music: "floating-cities",
      avatar: null,
      cost_usd: 0,
    });
  });

  it("runs every step on autopilot", async () => {
    const id = await createProduction(ctx, { idea: "Why the sky is blue" });
    await admin
      .from("productions")
      .update({
        style: "luminous-3d",
        voice_key: "design-m2",
        music_key: "wallpaper",
        step_modes: {
          idea: "auto",
          script: "auto",
          style: "auto",
          visuals: "auto",
          render: "auto",
        },
      })
      .eq("id", id);
    await startProduction(ctx, id);
    expect((await getProduction(admin, SANDBOX, id)).status).toBe("ready");
  });
});

describe("avatar videos: caps and kept clips", () => {
  it("charges the avatar clips once and keeps them when the voice is redone", async () => {
    await load("factory-rework");
    const id = stableUuid("factory-rework", "production", "done");
    const before = await spendSoFar(admin, SANDBOX, id, NOW);
    expect(before.videoUsd).toBeCloseTo(0.843, 3);

    await requestRework(ctx, id, { target: "voice", ref: null, note: "warmer", quoteUsd: 0 });
    await approveStep(ctx, id, "render");
    const afterVoice = await spendSoFar(admin, SANDBOX, id, NOW);
    expect(afterVoice.videoUsd).toBeCloseTo(before.videoUsd, 4);
    const jobs = await admin.from("gen_jobs").select("slot").eq("production_id", id);
    expect(jobs.data).toHaveLength(3);

    // Only an explicit slot redo pays again, for that slot.
    await requestRework(ctx, id, { target: "avatar_slot", ref: "hook", note: "", quoteUsd: 0.281 });
    const afterRedo = await spendSoFar(admin, SANDBOX, id, NOW);
    expect(afterRedo.videoUsd).toBeCloseTo(before.videoUsd + 0.281, 3);
    const again = await admin.from("gen_jobs").select("slot").eq("production_id", id);
    expect(again.data?.filter((j) => j.slot === "hook")).toHaveLength(2);
  });

  it("refuses a clip over the monthly cap with 402 budget, and approval says why", async () => {
    await load("factory-over-cap");
    const id = stableUuid("factory-over-cap", "production", "quote");
    await expect(approveStep(ctx, id, "face_quote")).rejects.toThrow(/monthly cap/);
    const err = await submitFaceJob(gen, {
      productionId: id,
      slot: "hook",
      model: "fal-kling-avatar-std",
      idempotencyKey: "k1",
      image: "x",
      audio: "y",
      seconds: 10,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenError);
    expect(err).toMatchObject({ status: 402, code: "budget", extra: { remaining_usd: 0.5 } });
  });

  it("approves a quote under the cap and pays for the clips at render", async () => {
    await load("factory-avatar-quote");
    const id = stableUuid("factory-avatar-quote", "production", "quote");
    await approveStep(ctx, id, "face_quote");
    expect(await statuses(id)).toMatchObject({ face_quote: "approved", render: "waiting" });
    const spend = await spendSoFar(admin, SANDBOX, id, NOW);
    expect(spend.videoUsd).toBeCloseTo(0.843, 3);
    expect(spend.monthUsd).toBeCloseTo(2.043, 3);
  });
});

describe("generation keys", () => {
  it("stores keys encrypted, shows only the last 4 and tests them", async () => {
    await load("factory-new");
    await saveGenKey(gen, "fal", "fal-sandbox-secret-1234");
    const stored = await admin
      .from("gen_keys")
      .select("key_enc")
      .eq("workspace_id", SANDBOX)
      .single();
    expect(stored.data?.key_enc).not.toContain("secret");
    expect(await listGenKeys(gen)).toMatchObject([{ provider: "fal", last4: "1234" }]);
    expect(await testGenKey(gen, "fal")).toMatchObject({ testOk: true });
  });
});
