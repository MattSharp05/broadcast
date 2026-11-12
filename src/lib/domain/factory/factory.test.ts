import { describe, expect, it } from "vitest";
import { capsFor, checkBudget, estimateFaceClips, monthStart, spendOf, usd } from "./budget";
import { creditLines, draftCaptions, withCredits } from "./captions";
import { decideFaceJob, type ExistingJob } from "./face-jobs";
import { FAKE_SLOTS, fakeOutput } from "./fake-outputs";
import {
  FACE_MODELS,
  enableableModels,
  faceModel,
  isSelectable,
  priceFor,
  resolveFaceModel,
} from "./models";
import { buildRecipe, recipeRows } from "./recipe";
import { isPaidRework, reworkStep, slotsTouched } from "./rework";
import {
  decideCheckpoint,
  modeFor,
  nextStep,
  parseModes,
  productionStatus,
  stepsFor,
} from "./steps";
import { STYLE_PACKS } from "./styles";

describe("face model registry", () => {
  it("mirrors face_models.json: placeholder is free and ready, planned models can't be picked", () => {
    const placeholder = faceModel("placeholder");
    expect(placeholder?.pricePerS).toBe(0);
    expect(placeholder?.status).toBe("ready");
    const hedra = faceModel("hedra-character-3");
    expect(hedra?.status).toBe("planned");
    expect(hedra && isSelectable(hedra)).toBe(false);
    expect(FACE_MODELS.length).toBeGreaterThanOrEqual(8);
  });

  it("only offers models whose provider has a key (free ones always)", () => {
    expect(enableableModels([]).map((m) => m.key)).toEqual(["placeholder"]);
    const withFal = enableableModels(["fal"]).map((m) => m.key);
    expect(withFal).toContain("fal-kling-avatar-std");
    expect(withFal).not.toContain("hedra-character-3");
  });

  it("prices by the second, rounded up to the billing increment", () => {
    const kling = faceModel("fal-kling-avatar-std");
    const mirage = faceModel("mirage-avatar-x");
    if (!kling || !mirage) throw new Error("registry changed");
    expect(priceFor(kling, 10)).toBeCloseTo(0.562, 4);
    // Mirage bills in 6 s blocks: 7 s → 12 s.
    expect(priceFor(mirage, 7)).toBeCloseTo(12 * 0.15, 4);
    expect(priceFor(kling, 0)).toBe(0);
  });

  it("resolves account default, then avatar, then video override", () => {
    const enabled = [
      "placeholder",
      "fal-kling-avatar-std",
      "fal-omnihuman-1.5",
      "fal-kling-avatar-pro",
    ];
    const base = { workspaceDefault: "placeholder", enabled };
    expect(resolveFaceModel(base)).toEqual({ key: "placeholder", source: "workspace" });
    expect(resolveFaceModel({ ...base, account: "fal-kling-avatar-std" }).source).toBe("account");
    expect(
      resolveFaceModel({ ...base, account: "fal-kling-avatar-std", avatar: "fal-omnihuman-1.5" }),
    ).toEqual({ key: "fal-omnihuman-1.5", source: "avatar" });
    expect(
      resolveFaceModel({
        ...base,
        account: "fal-kling-avatar-std",
        avatar: "fal-omnihuman-1.5",
        video: "fal-kling-avatar-pro",
      }),
    ).toEqual({ key: "fal-kling-avatar-pro", source: "video" });
    // A disabled override is skipped.
    expect(resolveFaceModel({ ...base, video: "hedra-character-3" }).source).toBe("workspace");
  });
});

describe("budget", () => {
  it("estimates registry price × seconds plus a re-roll allowance", () => {
    const e = estimateFaceClips("fal-kling-avatar-std", FAKE_SLOTS);
    expect(e.seconds).toBe(15);
    expect(e.baseUsd).toBeCloseTo(0.843, 3);
    expect(e.rerollUsd).toBeCloseTo(0.2108, 3);
    expect(e.totalUsd).toBeCloseTo(e.baseUsd + e.rerollUsd, 4);
    expect(estimateFaceClips("placeholder", FAKE_SLOTS).free).toBe(true);
  });

  it("refuses a quote that would pass either cap", () => {
    const caps = { perVideoUsd: 5, monthlyUsd: 50 };
    expect(checkBudget(1, { videoUsd: 3, monthUsd: 10 }, caps)).toEqual({
      ok: true,
      remainingUsd: 2,
    });
    expect(checkBudget(2.5, { videoUsd: 3, monthUsd: 10 }, caps)).toMatchObject({
      ok: false,
      which: "video",
    });
    expect(checkBudget(1, { videoUsd: 0, monthUsd: 49.5 }, caps)).toMatchObject({
      ok: false,
      which: "month",
      remainingUsd: 0.5,
    });
  });

  it("lowers the per-video cap to the avatar's own cap", () => {
    expect(capsFor({ perVideoUsd: 5, monthlyUsd: 50 }, 4)).toEqual({
      perVideoUsd: 4,
      monthlyUsd: 50,
    });
    expect(capsFor({ perVideoUsd: 5, monthlyUsd: 50 }, 9).perVideoUsd).toBe(5);
    expect(capsFor({ perVideoUsd: 5, monthlyUsd: 50 }, null).perVideoUsd).toBe(5);
  });

  it("counts cost when known, else the quote; failed jobs cost nothing", () => {
    expect(
      spendOf([
        { status: "completed", quote_usd: 1, cost_usd: 0.9 },
        { status: "running", quote_usd: 0.5, cost_usd: null },
        { status: "failed", quote_usd: 3, cost_usd: 0 },
      ]),
    ).toBeCloseTo(1.4, 4);
  });

  it("formats money and the month window", () => {
    expect(usd(2.5)).toBe("$2.50");
    expect(usd(0)).toBe("$0.00");
    expect(usd(0.0562)).toBe("$0.056");
    expect(monthStart(new Date("2026-11-12T03:00:00Z")).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
  });
});

describe("paid face clips are never generated twice", () => {
  const jobs: ExistingJob[] = [
    {
      id: "j1",
      slot: "hook",
      idempotencyKey: "k-hook-1",
      status: "completed",
      createdAt: "2026-11-01T00:00:00Z",
    },
    {
      id: "j2",
      slot: "mid",
      idempotencyKey: "k-mid-1",
      status: "failed",
      createdAt: "2026-11-01T00:00:00Z",
    },
  ];

  it("returns the earlier job for the same idempotency key", () => {
    expect(
      decideFaceJob({ slot: "hook", idempotencyKey: "k-hook-1", jobs, redoSlots: [] }),
    ).toMatchObject({
      kind: "existing",
      reason: "same_key",
    });
  });

  it("keeps a slot's clip when the audio changed (voice, music or script rework)", () => {
    expect(
      decideFaceJob({ slot: "hook", idempotencyKey: "k-hook-2", jobs, redoSlots: [] }),
    ).toMatchObject({
      kind: "existing",
      reason: "slot_kept",
      job: { id: "j1" },
    });
  });

  it("generates again only for an explicit redo of that slot, or after a failure", () => {
    expect(
      decideFaceJob({ slot: "hook", idempotencyKey: "k-hook-2", jobs, redoSlots: ["hook"] }),
    ).toEqual({
      kind: "new",
      redo: true,
    });
    expect(decideFaceJob({ slot: "mid", idempotencyKey: "k-mid-2", jobs, redoSlots: [] })).toEqual({
      kind: "new",
      redo: false,
    });
    expect(
      decideFaceJob({ slot: "cta", idempotencyKey: "k-cta-1", jobs, redoSlots: [] }).kind,
    ).toBe("new");
  });
});

describe("steps and autopilot", () => {
  it("runs the avatar quote only for avatar videos", () => {
    expect(stepsFor(false)).toEqual(["idea", "script", "style", "visuals", "render"]);
    expect(stepsFor(true)).toContain("face_quote");
    expect(nextStep("visuals", false)).toBe("render");
    expect(nextStep("visuals", true)).toBe("face_quote");
    expect(nextStep("render", true)).toBeNull();
  });

  it("uses the video's mode, then the workspace's, else wait", () => {
    expect(modeFor("script", { script: "auto" }, {})).toBe("auto");
    expect(modeFor("script", {}, { script: "auto" })).toBe("auto");
    expect(modeFor("script", { script: "wait" }, { script: "auto" })).toBe("wait");
    expect(modeFor("render", {}, {})).toBe("wait");
    expect(parseModes({ script: "auto", bogus: "auto", render: "maybe" })).toEqual({
      script: "auto",
    });
  });

  it("approves a paid step on autopilot only under the cap", () => {
    expect(decideCheckpoint({ step: "script", mode: "auto" })).toEqual({ approve: true });
    expect(decideCheckpoint({ step: "script", mode: "wait" }).approve).toBe(false);
    expect(
      decideCheckpoint({ step: "face_quote", mode: "auto", quoteUsd: 1, remainingUsd: 2 }),
    ).toEqual({
      approve: true,
    });
    expect(
      decideCheckpoint({ step: "face_quote", mode: "auto", quoteUsd: 3, remainingUsd: 2 }),
    ).toMatchObject({ approve: false, reason: "over_cap" });
  });

  it("derives the production status from its steps", () => {
    expect(productionStatus([{ step: "idea", status: "waiting" }], "running")).toBe("waiting");
    expect(productionStatus([{ step: "idea", status: "failed" }], "running")).toBe("failed");
    expect(
      productionStatus(
        [
          { step: "idea", status: "approved" },
          { step: "render", status: "approved" },
        ],
        "running",
      ),
    ).toBe("ready");
    expect(productionStatus([{ step: "idea", status: "approved" }], "scheduled")).toBe("scheduled");
  });
});

describe("rework", () => {
  it("reruns the right step and only charges for an avatar slot", () => {
    expect(reworkStep("voice")).toBe("render");
    expect(reworkStep("scene")).toBe("visuals");
    expect(reworkStep("script_line")).toBe("script");
    expect(reworkStep("caption")).toBeNull();
    expect(isPaidRework("voice")).toBe(false);
    expect(isPaidRework("avatar_slot")).toBe(true);
  });

  it("finds the avatar slots a script change touches", () => {
    const lines = [
      { id: "l1", text: "a", slot: "hook" },
      { id: "l2", text: "b" },
    ];
    expect(slotsTouched(lines, ["l1", "l2"])).toEqual(["hook"]);
    expect(slotsTouched(lines, ["l2"])).toEqual([]);
  });
});

describe("captions and recipe", () => {
  it("adds the credit lines a video needs (CC BY music, AI voice, avatar, imagery)", () => {
    const credits = creditLines({
      musicCredit: 'Music: "Floating Cities" by Kevin MacLeod (incompetech.com), CC BY 4.0',
      musicLicence: "CC BY 4.0",
      voiceCredit: "Voice: AI (Qwen3-TTS)",
      avatar: true,
      imagery: ["Earth imagery: NASA.", ""],
    });
    expect(credits).toHaveLength(4);
    expect(
      creditLines({
        musicCredit: "x",
        musicLicence: "CC0",
        voiceCredit: null,
        avatar: false,
        imagery: [],
      }),
    ).toEqual([]);
    expect(withCredits("Hello", ["A", "B"])).toBe("Hello\n\nA\nB");
    expect(withCredits("Hello\n\nA", ["A", "B"])).toBe("Hello\n\nA\nB");
    const options = draftCaptions({ title: "How tides work", idea: "", hook: "Wrong!", credits });
    expect(options).toHaveLength(3);
    for (const o of options) expect(o).toContain("CC BY 4.0");
  });

  it("tags every part of the video and lists it for the post drawer", () => {
    const recipe = buildRecipe({
      productionId: "p1",
      style: "luminous-3d",
      avatarName: "Maya",
      avatarVersion: 2,
      faceModel: "fal-kling-avatar-std",
      faceShare: 0.2512,
      voice: "design-f2",
      music: "floating-cities",
      hook: "Wrong!",
      scriptVersion: 3,
      series: null,
      costUsd: 0.84321,
    });
    expect(recipe).toMatchObject({ avatar_version: 2, face_share: 0.251, cost_usd: 0.8432 });
    const rows = recipeRows(recipe);
    expect(rows.find((r) => r.label === "Avatar")?.value).toBe("Maya v2");
    expect(rows.find((r) => r.label === "Face share")?.value).toBe("25%");
    // No avatar: no face parts.
    const plain = buildRecipe({
      ...recipe,
      productionId: "p2",
      avatarName: null,
      avatarVersion: 1,
      faceModel: "x",
      faceShare: 0.3,
      voice: null,
      music: null,
      hook: null,
      scriptVersion: null,
      series: null,
      costUsd: 0,
      style: null,
    });
    expect(plain.face_model).toBeNull();
    expect(recipeRows(null)).toEqual([]);
  });
});

describe("fake runner outputs", () => {
  const ctx = {
    idea: "How tides work",
    style: "realistic-3d",
    useAvatar: true,
    faceModel: "fal-kling-avatar-std",
    scriptVersion: 0,
    attempt: 0,
  };
  it("gives every step a canned output", () => {
    expect(fakeOutput("idea", ctx)).toMatchObject({ title: "How tides work" });
    const script = fakeOutput("script", ctx) as {
      version: number;
      lines: { slot?: string | null }[];
    };
    expect(script.version).toBe(1);
    expect(script.lines.filter((l) => l.slot)).toHaveLength(3);
    expect(fakeOutput("face_quote", ctx)).toMatchObject({ model: "fal-kling-avatar-std" });
    expect(fakeOutput("render", ctx)).toMatchObject({ duration_s: 60, face_share: 0.25 });
    expect(fakeOutput("render", { ...ctx, useAvatar: false })).toMatchObject({ face_share: null });
  });

  it("has an example frame for every style that a past project used", () => {
    expect(STYLE_PACKS).toHaveLength(5);
    expect(STYLE_PACKS.filter((s) => s.example).map((s) => s.key)).toEqual([
      "editorial-collage",
      "luminous-3d",
      "motion-graphics",
      "realistic-3d",
    ]);
  });
});
