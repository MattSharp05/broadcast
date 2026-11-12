import { describe, expect, it } from "vitest";
import {
  assembleProfile,
  fakeCandidates,
  needsNewVersion,
  nextStudioStep,
  stepPicked,
  studioEstimate,
} from "./avatar";

describe("avatar studio", () => {
  const models = { primary: "fal-kling-avatar-std", fallback: "placeholder" };

  it("walks persona → portrait → face pack → voice → screen test → done", () => {
    expect(nextStudioStep("persona")).toBe("portrait");
    expect(nextStudioStep("voice")).toBe("screen_test");
    expect(nextStudioStep("screen_test")).toBe("done");
  });

  it("prices the paid steps before they run", () => {
    expect(studioEstimate("persona", models)).toBe(0);
    expect(studioEstimate("portrait", models)).toBeCloseTo(0.32, 4);
    // 10 s on Kling Standard; the placeholder fallback is free.
    expect(studioEstimate("screen_test", models)).toBeCloseTo(0.562, 3);
  });

  it("needs a pick (or 4 approved shots) before moving on", () => {
    const pack = fakeCandidates("face_pack", { name: "Leo", voices: [], models }).face_pack ?? [];
    expect(stepPicked("face_pack", { face_pack: pack })).toMatch(/at least 4/);
    const approved = pack.map((c, i) => ({
      ...c,
      status: i < 4 ? ("approved" as const) : ("rejected" as const),
    }));
    expect(stepPicked("face_pack", { face_pack: approved })).toBeNull();
    expect(stepPicked("persona", {})).toBe("Pick a persona.");
  });

  it("assembles avatar.json from the picks, disclosed as AI", () => {
    const studio = {
      ...fakeCandidates("persona", { name: "Leo", voices: [], models }),
      persona_pick: "p2",
      portraits: [{ id: "m1", url: "storage:factory/x.png", label: "A" }],
      portrait_pick: "m1",
      voice_pick: "design-m2",
      screen_tests: [{ model: "fal-kling-avatar-std", url: "x", cost_usd: 0.56 }],
      screen_pick: "fal-kling-avatar-std",
    };
    const p = assembleProfile({ base: {}, studio, account: "@a", version: 1, capUsd: 4 }) as Record<
      string,
      Record<string, unknown>
    >;
    expect(p.identity).toMatchObject({ name: "Leo", from: "Austin" });
    expect(p.look).toMatchObject({ master_ref: "storage:factory/x.png" });
    expect(p.voice).toMatchObject({ voice_id: "design-m2" });
    expect(p.generation).toMatchObject({
      face_model: "fal-kling-avatar-std",
      cost_cap_per_video_usd: 4,
    });
    expect(p.rules).toMatchObject({ platform_flags: { instagram: { is_ai_generated: true } } });
  });

  it("bumps the version only when the look or the voice changes", () => {
    const before = { look: { master_ref: "a" }, voice: { voice_id: "x" }, notes: "" };
    expect(needsNewVersion(before, { ...before, notes: "more" })).toBe(false);
    expect(needsNewVersion(before, { ...before, voice: { voice_id: "y" } })).toBe(true);
    expect(needsNewVersion(before, { ...before, look: { master_ref: "b" } })).toBe(true);
  });
});
