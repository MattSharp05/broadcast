import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fireRoutine, firePayloadText, ROUTINE_FIRE_URL } = await import("./runner");
const { falProvider } = await import("./gen-providers");
const { faceModel } = await import("@/lib/domain/factory/models");

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const payload = {
  productionId: "p-1",
  step: "script" as const,
  appUrl: "https://broadcast.example",
  token: "bcf_live_x",
  note: "shorter hook",
};
const env = { FACTORY_ROUTINE_ID: "trig_123", FACTORY_ROUTINE_TOKEN: "sk-ant-oat01-abc" };

describe("routines trigger", () => {
  it("gives a prompt to paste when the routine isn't set up (nothing is fired)", async () => {
    const result = await fireRoutine(payload, {});
    expect(result.kind).toBe("manual");
    if (result.kind === "manual") {
      expect(result.prompt).toContain("BROADCAST_VIDEO_ID=p-1");
      expect(result.prompt).toContain("STEP=script");
      expect(result.prompt).toContain(".claude/skills/broadcast-factory/SKILL.md");
    }
  });

  it("fires the routine with the bearer token and beta header and returns the session", async () => {
    let seen: { auth: string | null; beta: string | null; body: unknown } | null = null;
    server.use(
      http.post(`${ROUTINE_FIRE_URL}/trig_123/fire`, async ({ request }) => {
        seen = {
          auth: request.headers.get("authorization"),
          beta: request.headers.get("anthropic-beta"),
          body: await request.json(),
        };
        return HttpResponse.json({
          type: "routine_fire",
          claude_code_session_id: "session_01",
          claude_code_session_url: "https://claude.ai/code/session_01",
        });
      }),
    );
    const result = await fireRoutine(payload, env);
    expect(result).toEqual({
      kind: "session",
      sessionId: "session_01",
      sessionUrl: "https://claude.ai/code/session_01",
    });
    expect(seen).toEqual({
      auth: "Bearer sk-ant-oat01-abc",
      beta: "experimental-cc-routine-2026-04-01",
      body: { text: firePayloadText(payload) },
    });
  });

  it("explains a refused fire", async () => {
    server.use(
      http.post(`${ROUTINE_FIRE_URL}/trig_123/fire`, () =>
        HttpResponse.json(
          { type: "error", error: { type: "authentication_error", message: "bad token" } },
          { status: 401 },
        ),
      ),
    );
    const result = await fireRoutine(payload, env);
    expect(result.kind).toBe("error");
    if (result.kind === "error")
      expect(result.message).toMatch(/401.*bad token.*FACTORY_ROUTINE_TOKEN/);
  });
});

describe("fal adapter (MSW, never the real API)", () => {
  const model = faceModel("fal-kling-avatar-std");
  if (!model) throw new Error("registry changed");

  it("submits with the model's input names and Key auth, then polls to the video URL", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(
        "https://queue.fal.run/fal-ai/kling-video/ai-avatar/v2/standard",
        async ({ request }) => {
          expect(request.headers.get("authorization")).toBe("Key fal-key");
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            request_id: "r1",
            status_url: "https://queue.fal.run/fal-ai/kling-video/requests/r1/status",
            response_url: "https://queue.fal.run/fal-ai/kling-video/requests/r1",
          });
        },
      ),
      http.get("https://queue.fal.run/fal-ai/kling-video/requests/r1/status", () =>
        HttpResponse.json({ status: "COMPLETED" }),
      ),
      http.get("https://queue.fal.run/fal-ai/kling-video/requests/r1", () =>
        HttpResponse.json({ video: { url: "https://v3.fal.media/files/out.mp4" } }),
      ),
    );
    const sub = await falProvider.submit(
      {
        model,
        image: "data:image/png;base64,AA",
        audio: "data:audio/wav;base64,AA",
        prompt: "Talk",
        seed: 7,
      },
      "fal-key",
    );
    expect(body).toEqual({
      image_url: "data:image/png;base64,AA",
      audio_url: "data:audio/wav;base64,AA",
      prompt: "Talk",
      seed: 7,
    });
    expect(await falProvider.poll(sub, model, "fal-key")).toEqual({
      status: "completed",
      outputUrl: "https://v3.fal.media/files/out.mp4",
    });
  });

  it("reads a failed request (COMPLETED with an error) as failed", async () => {
    server.use(
      http.get("https://q/status", () =>
        HttpResponse.json({ status: "COMPLETED", error: "face not found" }),
      ),
    );
    expect(
      await falProvider.poll(
        { requestId: "r", statusUrl: "https://q/status", responseUrl: "https://q/r" },
        model,
        "k",
      ),
    ).toEqual({ status: "failed", error: "fal: face not found" });
  });

  it("tests a key with a free pricing call", async () => {
    server.use(
      http.get("https://api.fal.ai/v1/models/pricing", ({ request }) =>
        request.headers.get("authorization") === "Key good"
          ? HttpResponse.json({ prices: [] })
          : HttpResponse.json({ error: { type: "authorization_error" } }, { status: 401 }),
      ),
    );
    expect((await falProvider.testKey("good")).ok).toBe(true);
    expect(await falProvider.testKey("nope")).toMatchObject({ ok: false });
  });
});
