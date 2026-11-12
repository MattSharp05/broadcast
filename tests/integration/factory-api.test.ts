import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as assetsPost } from "@/app/api/factory/[id]/assets/route";
import { GET as briefGet } from "@/app/api/factory/[id]/brief/route";
import { POST as checkpointPost } from "@/app/api/factory/[id]/checkpoint/route";
import { POST as failPost } from "@/app/api/factory/[id]/fail/route";
import { POST as progressPost } from "@/app/api/factory/[id]/progress/route";
import { GET as jobGet } from "@/app/api/gen/face-jobs/[jobId]/route";
import { POST as jobPost } from "@/app/api/gen/face-jobs/route";
import { GET as modelsGet } from "@/app/api/gen/models/route";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { mintFactoryToken } from "@/lib/factory/engine";
import { stableUuid } from "@/lib/hash";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { adminClient } from "./helpers";

// BC-26/28: the factory API and the generation proxy (docs/factory-api.md) against the local
// stack, with factory tokens. The Sandbox's fake generation provider: no money, no network.

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");
const ctx = { db: admin, workspaceId: SANDBOX, now: NOW };

async function load(name: string) {
  const s = getScenario(name);
  if (!s) throw new Error(name);
  await loadScenario(admin, s, { fixedNow: NOW });
}

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

describe("factory API", () => {
  const render = stableUuid("factory-pipeline", "production", "render");
  const script = stableUuid("factory-pipeline", "production", "script");
  let token = "";

  beforeEach(async () => {
    await load("factory-pipeline");
    token = await mintFactoryToken(ctx, render);
  });

  it("needs a factory token for this video", async () => {
    expect((await call(briefGet, { id: render }, null)).status).toBe(401);
    expect((await call(briefGet, { id: render }, "bcf_sandbox_" + "x".repeat(43))).status).toBe(
      401,
    );
    const other = await call(briefGet, { id: script }, token);
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: "wrong_video" });
  });

  it("gives the brief, takes progress, and fails a step with a message", async () => {
    const res = await call(briefGet, { id: render }, token);
    expect(res.status).toBe(200);
    const brief = (await res.json()) as {
      video: { music: { credit: string } };
      step: unknown;
      outputs: { script: { lines: unknown[] } };
    };
    expect(brief.video).toMatchObject({ style: "motion-graphics", use_avatar: false });
    expect(brief.video.music.credit).toContain("Floating Cities");
    expect(brief.step).toMatchObject({ name: "render" });
    expect(brief.outputs.script.lines.length).toBeGreaterThan(0);

    expect(
      (
        await call(progressPost, { id: render }, token, {
          step: "render",
          progress: 80,
          message: "Scene 4",
        })
      ).status,
    ).toBe(204);
    const row = await admin
      .from("production_steps")
      .select("progress, message")
      .eq("production_id", render)
      .eq("step", "render")
      .single();
    expect(row.data).toEqual({ progress: 80, message: "Scene 4" });

    expect(
      (
        await call(failPost, { id: render }, token, {
          step: "render",
          message: "Out of memory.",
        })
      ).status,
    ).toBe(204);
    const failed = await admin.from("productions").select("status").eq("id", render).single();
    expect(failed.data?.status).toBe("failed");
  });

  it("stores an uploaded render with its recipe and never queues it", async () => {
    const asked = await call(assetsPost, { id: render }, token, {
      name: "final.mp4",
      content_type: "video/mp4",
    });
    expect(asked.status).toBe(201);
    const { path, upload_url } = (await asked.json()) as { path: string; upload_url: string };
    expect(path).toMatch(new RegExp(`^storage:videos/${SANDBOX}/videos/factory-`));
    const put = await fetch(upload_url, {
      method: "PUT",
      headers: { "content-type": "video/mp4" },
      body: readFileSync(join(process.cwd(), "tests/fixtures/video", "reel-9x16.mp4")),
    });
    expect(put.ok).toBe(true);

    const res = await call(checkpointPost, { id: render }, token, {
      step: "render",
      output: {
        upload: path,
        duration_s: 12,
        face_share: null,
        imagery_credits: ["Earth imagery: NASA."],
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "waiting", next_step: null });
    const p = await admin
      .from("productions")
      .select("media_id, caption_options, post_id")
      .eq("id", render)
      .single();
    expect(p.data?.post_id).toBeNull();
    expect(JSON.stringify(p.data?.caption_options)).toContain("Earth imagery: NASA.");
    const media = await admin
      .from("media_assets")
      .select("recipe, storage_path")
      .eq("id", p.data?.media_id ?? "")
      .single();
    expect(media.data?.recipe).toMatchObject({
      style: "motion-graphics",
      music: "floating-cities",
    });
    const posts = await admin
      .from("posts")
      .select("id")
      .eq("media_id", p.data?.media_id ?? "");
    expect(posts.data).toEqual([]);
  });

  it("refuses a checkpoint for a step that isn't running, and a render that isn't an upload", async () => {
    const wrong = await call(checkpointPost, { id: render }, token, {
      step: "idea",
      output: {},
    });
    expect(wrong.status).toBe(409);
    const bad = await call(checkpointPost, { id: render }, token, {
      step: "render",
      output: { upload: "https://elsewhere/x.mp4" },
    });
    expect(bad.status).toBe(422);
  });
});

describe("generation proxy", () => {
  it("charges once per key, keeps a slot's clip, and polls jobs", async () => {
    await load("factory-avatar-quote");
    const id = stableUuid("factory-avatar-quote", "production", "quote");
    const token = await mintFactoryToken(ctx, id);
    const body = {
      video_id: id,
      slot: "hook",
      model: "fal-kling-avatar-std",
      idempotency_key: "k-hook-1",
      image: "data:image/png;base64,AA",
      audio: "data:audio/wav;base64,AA",
      seconds: 5,
    };
    const first = await call(jobPost, {}, token, body);
    expect(first.status).toBe(200);
    const job = (await first.json()) as { job_id: string; quote_usd: number };
    expect(job.quote_usd).toBeCloseTo(0.281, 3);

    const again = await call(jobPost, {}, token, body);
    expect(await again.json()).toMatchObject({ job_id: job.job_id, reused: "same_key" });
    const newAudio = await call(jobPost, {}, token, {
      ...body,
      idempotency_key: "k-hook-2",
    });
    expect(await newAudio.json()).toMatchObject({ job_id: job.job_id, reused: "slot_kept" });

    const polled = await call(jobGet, { jobId: job.job_id }, token);
    expect(await polled.json()).toMatchObject({ status: "completed", cost_usd: 0.281 });

    const wrongVideo = await call(jobPost, {}, token, {
      ...body,
      video_id: stableUuid("x"),
    });
    expect(wrongVideo.status).toBe(403);

    const models = (await (await call(modelsGet, {}, token)).json()) as {
      default: string;
      models: { key: string }[];
    };
    expect(models.default).toBe("fal-kling-avatar-std");
    expect(models.models.map((m) => m.key)).not.toContain("hedra-character-3");
  });

  it("answers 402 budget over the cap, with what is left", async () => {
    await load("factory-over-cap");
    const id = stableUuid("factory-over-cap", "production", "quote");
    const token = await mintFactoryToken(ctx, id);
    const res = await call(jobPost, {}, token, {
      video_id: id,
      slot: "hook",
      model: "fal-kling-avatar-std",
      idempotency_key: "k1",
      image: "x",
      audio: "y",
      seconds: 10,
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "budget", remaining_usd: 0.5 });
    const jobs = await admin.from("gen_jobs").select("id").eq("production_id", id);
    expect(jobs.data).toEqual([]);
  });
});
