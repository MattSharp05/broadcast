import { describe, expect, it } from "vitest";
import { createRng, hash32 } from "@/lib/hash";
import { SCENARIOS, getScenario } from "./index";

const NOW = new Date("2026-11-05T22:14:00Z");
const build = (name: string) => {
  const s = getScenario(name);
  if (!s) throw new Error(`no scenario ${name}`);
  return s.build({ now: NOW, rng: createRng(hash32(name)) });
};

describe("scenario registry", () => {
  it("has unique, URL-safe names and a description each", () => {
    const names = SCENARIOS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of SCENARIOS) {
      expect(s.name).toMatch(/^[a-z0-9-]+$/);
      expect(s.description.length).toBeGreaterThan(10);
    }
    expect(names).toEqual(expect.arrayContaining(["canvas-busy", "empty"]));
  });

  it.each(SCENARIOS.map((s) => s.name))("%s is deterministic", (name) => {
    expect(build(name)).toEqual(build(name));
  });

  it.each(SCENARIOS.map((s) => s.name))("%s only uses fake accounts", (name) => {
    expect(build(name).accounts.every((a) => a.platform === "fake")).toBe(true);
  });

  it.each(SCENARIOS.map((s) => s.name))("%s rows reference rows it creates", (name) => {
    const seed = build(name);
    const brands = new Set(seed.brands.map((b) => b.id));
    const accounts = new Set(seed.accounts.map((a) => a.id));
    const media = new Set(seed.media.map((m) => m.id));
    const posts = new Set(seed.posts.map((p) => p.id));
    expect(seed.accounts.every((a) => brands.has(a.brand_id))).toBe(true);
    expect(seed.fakeAccounts.map((f) => f.account_id).sort()).toEqual([...accounts].sort());
    expect(seed.posts.every((p) => accounts.has(p.account_id) && media.has(p.media_id))).toBe(true);
    expect(seed.postMetrics.every((m) => posts.has(m.post_id))).toBe(true);
    // Every published post is known to the fake provider, under the same container and media id.
    const containers = new Map(seed.fakeContainers.map((c) => [c.id, c]));
    for (const p of seed.posts.filter((x) => x.status === "published")) {
      expect(containers.get(p.container_id ?? "")?.media_id).toBe(p.media_ig_id);
    }
  });
});

describe("canvas-busy", () => {
  const seed = build("canvas-busy");
  const byHandle = (h: string) => seed.accounts.find((a) => a.handle === h);
  const postsOf = (h: string) => seed.posts.filter((p) => p.account_id === byHandle(h)?.id);

  it("has the mockup's five accounts in five brands", () => {
    expect(seed.brands).toHaveLength(5);
    expect(seed.accounts.map((a) => a.handle)).toEqual([
      "codingjourney",
      "trip.app",
      "ai.explained.daily",
      "tri.weekly",
      "driftship",
    ]);
  });

  it("has one account needing attention, with a paused queue and expired access", () => {
    const tri = byHandle("tri.weekly");
    expect(tri?.status).toBe("needs_attention");
    expect(tri?.status_reason).toMatch(/expired on 2 Nov/);
    expect(seed.fakeAccounts.find((f) => f.account_id === tri?.id)?.failure_mode).toBe(
      "token_expired",
    );
    const upcoming = postsOf("tri.weekly").filter((p) => p.status !== "published");
    expect(upcoming.length).toBeGreaterThan(0);
    expect(upcoming.every((p) => p.status === "paused")).toBe(true);
  });

  it("has exactly one failed post, on @trip.app, with the reason", () => {
    const failed = seed.posts.filter((p) => p.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.account_id).toBe(byHandle("trip.app")?.id);
    expect(failed[0]?.last_error).toContain("9:16");
  });

  it("times every upcoming post in the future and every posted one in the past", () => {
    for (const p of seed.posts) {
      const at = new Date(p.scheduled_at ?? 0);
      if (p.status === "queued" || p.status === "paused") expect(at > NOW).toBe(true);
      else expect(at < NOW).toBe(true);
    }
  });

  it("has a pinned post on @codingjourney", () => {
    const pinned = postsOf("codingjourney").filter((p) => p.timing === "pinned");
    expect(pinned).toHaveLength(1);
  });

  it("has stats taken only for snapshots already due", () => {
    expect(seed.postMetrics.length).toBeGreaterThan(0);
    for (const m of seed.postMetrics) {
      if (new Date(m.due_at) <= NOW) expect(m.views).toBeGreaterThanOrEqual(0);
      else expect(m.taken_at ?? null).toBeNull();
    }
  });
});

describe("empty", () => {
  it("has one brand, one account and no posts", () => {
    const seed = build("empty");
    expect(seed.brands).toHaveLength(1);
    expect(seed.accounts).toHaveLength(1);
    expect(seed.posts).toHaveLength(0);
  });
});
