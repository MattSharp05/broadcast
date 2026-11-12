import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as decisionsGet } from "@/app/api/factory/hero-decisions/route";
import { GET as proposalGet } from "@/app/api/factory/hero-proposals/[proposalId]/route";
import { POST as proposalPost } from "@/app/api/factory/hero-proposals/route";
import { GET as meshGet } from "@/app/api/gen/mesh-jobs/[jobId]/route";
import { POST as meshPost } from "@/app/api/gen/mesh-jobs/route";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { mintFactoryToken } from "@/lib/factory/engine";
import { decide } from "@/lib/factory/hero";
import { stableUuid } from "@/lib/hash";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { adminClient } from "./helpers";

// BC-30: hero 3D asset proposals, decisions and mesh jobs (Sandbox: fake provider, no fal).

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");
const ctx = { db: admin, workspaceId: SANDBOX, now: NOW };
const hctx = { ...ctx, sandbox: true };
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function call<P>(
  handler: (r: NextRequest, c: { params: Promise<P> }) => Promise<Response>,
  params: P,
  token: string,
  body?: unknown,
) {
  return handler(
    new NextRequest("http://localhost/api/x", {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  );
}

describe("hero 3D assets", () => {
  const video = stableUuid("factory-hero-proposal", "production", "vegas");
  const hero = stableUuid("factory-hero-proposal", "hero", "sphere");
  let token = "";

  beforeEach(async () => {
    const s = getScenario("factory-hero-proposal");
    if (!s) throw new Error("scenario");
    await loadScenario(admin, s, { fixedNow: NOW });
    token = await mintFactoryToken(ctx, video);
  });

  it("takes a proposal with stills (data URIs stored), idempotently, and shows it pending", async () => {
    const body = {
      proposal_id: "ps5-1",
      video_id: video,
      object: "PS5",
      input: { mode: "image", prompt: "a PS5", image: PNG },
      suggested_model: "tripo-v2.5",
      estimate_usd: 0.3,
      stills: [{ label: "threejs-wide", image: PNG }],
      stage: "proposal",
    };
    const first = await call(proposalPost, {}, token, body);
    expect(await first.json()).toEqual({ proposal_id: "ps5-1", status: "pending" });
    await call(proposalPost, {}, token, body);
    const rows = await admin
      .from("hero_proposals")
      .select("stills, input")
      .eq("proposal_id", "ps5-1");
    expect(rows.data).toHaveLength(1);
    expect(JSON.stringify(rows.data?.[0]?.stills)).toContain("storage:factory/");
    const status = await call(proposalGet, { proposalId: "ps5-1" }, token);
    expect(await status.json()).toMatchObject({ status: "pending", decision: null });
    const wrong = await call(proposalPost, {}, token, { ...body, video_id: stableUuid("x") });
    expect(wrong.status).toBe(403);
  });

  it("refuses a mesh job until Matthew approves generate for that model; then charges once", async () => {
    const job = {
      kind: "mesh",
      proposal_id: "vegas-sphere-1",
      video_id: video,
      model: "tripo-v2.5",
      idempotency_key: "k1",
      mode: "image",
      image: PNG,
      options: { texture: true },
      quote_usd: 0.3,
    };
    const refused = await call(meshPost, {}, token, job);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "not_approved" });

    await expect(
      decide(hctx, hero, { choice: "generate", model: "tripo-v2.5", reason: "" }),
    ).rejects.toThrow(/why/);
    await decide(hctx, hero, {
      choice: "generate",
      model: "tripo-v2.5",
      reason: "Close-up, worth trying",
    });
    const status = (await (
      await call(proposalGet, { proposalId: "vegas-sphere-1" }, token)
    ).json()) as {
      decision: { choice: string; model: string; budget_usd: number };
    };
    expect(status.decision).toMatchObject({
      choice: "generate",
      model: "tripo-v2.5",
      budget_usd: 0.3,
    });

    // Another model than the approved one is still refused.
    expect(
      (await call(meshPost, {}, token, { ...job, model: "meshy-6", idempotency_key: "k0" })).status,
    ).toBe(403);

    const ok = (await (await call(meshPost, {}, token, job)).json()) as {
      job_id: string;
      quote_usd: number;
    };
    expect(ok.quote_usd).toBeCloseTo(0.3, 4);
    const again: unknown = await (await call(meshPost, {}, token, job)).json();
    expect(again).toMatchObject({ job_id: ok.job_id, reused: "same_key" });
    const polled: unknown = await (await call(meshGet, { jobId: ok.job_id }, token)).json();
    expect(polled).toMatchObject({ status: "completed", cost_usd: 0.3 });

    const exported = (await (await call(decisionsGet, {}, token)).json()) as {
      choice: string;
      reason: string;
    }[];
    expect(exported).toEqual([
      expect.objectContaining({
        proposal_id: "vegas-sphere-1",
        choice: "generate",
        model: "tripo-v2.5",
        cost_usd: 0.3,
      }),
    ]);
  });

  it("over the cap: 402 budget, nothing logged", async () => {
    await decide(hctx, hero, { choice: "generate", model: "tripo-v2.5", reason: "try it" });
    await admin
      .from("factory_settings")
      .update({ cap_per_video_usd: 0.1 })
      .eq("workspace_id", SANDBOX);
    const res = await call(meshPost, {}, token, {
      proposal_id: "vegas-sphere-1",
      video_id: video,
      model: "tripo-v2.5",
      idempotency_key: "k2",
      mode: "image",
      image: PNG,
    });
    expect(res.status).toBe(402);
    const jobs = await admin
      .from("gen_jobs")
      .select("id")
      .eq("kind", "mesh")
      .eq("production_id", video);
    expect(jobs.data).toEqual([]);
  });
});
