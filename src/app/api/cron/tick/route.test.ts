import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runTick = vi.fn();
vi.mock("@/lib/scheduler/tick", () => ({ runTick }));
vi.mock("@/lib/db/admin", () => ({ createAdminSupabase: () => ({}) }));

const { POST } = await import("./route");

function request(secret?: string) {
  return new NextRequest("http://localhost/api/cron/tick", {
    method: "POST",
    headers: secret === undefined ? {} : { "x-cron-secret": secret },
  });
}

describe("POST /api/cron/tick", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "the-secret");
    runTick.mockReset().mockResolvedValue({ startedAt: "x", ms: 1, steps: {} });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("runs a tick with the right secret and returns its summary", async () => {
    const res = await POST(request("the-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ startedAt: "x", ms: 1, steps: {} });
    expect(runTick).toHaveBeenCalledOnce();
  });

  it.each([["wrong"], [""], [undefined]])("401 and nothing runs for secret %j", async (secret) => {
    const res = await POST(request(secret));
    expect(res.status).toBe(401);
    expect(runTick).not.toHaveBeenCalled();
  });

  it("401 when CRON_SECRET isn't configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await POST(request(""));
    expect(res.status).toBe(401);
    expect(runTick).not.toHaveBeenCalled();
  });
});
