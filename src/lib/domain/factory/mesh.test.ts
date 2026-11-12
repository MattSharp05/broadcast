import { describe, expect, it } from "vitest";
import { falMeshRequest, isChoice, meshApproval, meshModel, meshOptions, meshPrice } from "./mesh";

describe("mesh models", () => {
  it("prices the base call plus options (Tripo: $0.20, +$0.10 texture, HD instead of texture)", () => {
    const tripo = meshModel("tripo-v2.5");
    if (!tripo) throw new Error("registry changed");
    expect(meshPrice(tripo, meshOptions(tripo, null))).toBeCloseTo(0.3, 4);
    expect(meshPrice(tripo, meshOptions(tripo, { hd: true, texture: true }))).toBeCloseTo(0.4, 4);
    expect(meshPrice(tripo, meshOptions(tripo, []))).toBeCloseTo(0.2, 4);
    const h2 = meshModel("hunyuan3d-v2");
    if (!h2) throw new Error("registry changed");
    expect(meshPrice(h2, meshOptions(h2, null))).toBeCloseTo(0.48, 4);
  });

  it("builds the fal request from the registry", () => {
    const tripo = meshModel("tripo-v2.5");
    if (!tripo) throw new Error("registry changed");
    const req = falMeshRequest(tripo, {
      mode: "image",
      image: "https://x/i.png",
      prompt: null,
      seed: 7,
      options: ["texture"],
    });
    expect(req).toEqual({
      endpoint: "tripo3d/tripo/v2.5/image-to-3d",
      input: { texture: "standard", orientation: "default", image_url: "https://x/i.png", seed: 7 },
      output: "model_mesh.url",
    });
    // Tripo has no text-to-3D.
    expect(
      falMeshRequest(tripo, {
        mode: "text",
        image: null,
        prompt: "a PS5",
        seed: null,
        options: [],
      }),
    ).toBeNull();
  });

  it("needs Matthew's generate decision for that model, within its budget", () => {
    const d = (choice: string, model: string | null, budget: number | null, at: string) => ({
      choice,
      model,
      budget_usd: budget,
      decided_at: at,
    });
    expect(meshApproval([], "tripo-v2.5", 0.3)).toEqual({ ok: false, reason: "not_approved" });
    expect(
      meshApproval([d("generate", "tripo-v2.5", 0.3, "2026-11-12T01:00:00Z")], "tripo-v2.5", 0.3),
    ).toEqual({ ok: true });
    expect(
      meshApproval([d("generate", "meshy-6", 1, "2026-11-12T01:00:00Z")], "tripo-v2.5", 0.3).ok,
    ).toBe(false);
    expect(
      meshApproval([d("generate", "tripo-v2.5", 0.2, "2026-11-12T01:00:00Z")], "tripo-v2.5", 0.3),
    ).toEqual({ ok: false, reason: "over_budget" });
    // A later "keep three.js" withdraws it.
    expect(
      meshApproval(
        [
          d("generate", "tripo-v2.5", 1, "2026-11-12T01:00:00Z"),
          d("keep_threejs", null, null, "2026-11-12T02:00:00Z"),
        ],
        "tripo-v2.5",
        0.3,
      ).ok,
    ).toBe(false);
    expect(isChoice("proposal", "use_generated")).toBe(false);
    expect(isChoice("comparison", "use_generated")).toBe(true);
  });
});
