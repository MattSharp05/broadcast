import { describe, expect, it } from "vitest";
import { createRng, hash32 } from "@/lib/hash";
import { getScenario, type SandboxSeed } from "@/lib/scenarios";
import {
  avatarIndex,
  buildCanvas,
  failureSummary,
  initials,
  profileUrl,
  type CanvasInput,
  type CanvasPostInput,
} from "./canvas";

const NOW = new Date("2026-11-05T22:14:00Z");

function seedOf(name: string): SandboxSeed {
  const s = getScenario(name);
  if (!s) throw new Error(`no scenario ${name}`);
  return s.build({ now: NOW, rng: createRng(hash32(name)) });
}

/** The loader's job for a scenario seed: rows → canvas input (accounts in seed order). */
function inputOf(seed: SandboxSeed, now = NOW): CanvasInput {
  const brands = new Map(seed.brands.map((b) => [b.id, b.name]));
  const media = new Map(seed.media.map((m) => [m.id, m]));
  const metrics = new Map<string, { views: number; likes: number; comments: number }>();
  for (const m of [...seed.postMetrics].sort((a, b) =>
    (b.taken_at ?? "").localeCompare(a.taken_at ?? ""),
  )) {
    if (m.taken_at && !metrics.has(m.post_id)) {
      metrics.set(m.post_id, {
        views: m.views ?? 0,
        likes: m.likes ?? 0,
        comments: m.comments ?? 0,
      });
    }
  }
  const posts: CanvasPostInput[] = seed.posts.map((p) => ({
    id: p.id ?? "",
    accountId: p.account_id,
    caption: p.caption ?? "",
    timing: p.timing ?? "queue",
    queuePosition: p.queue_position ?? null,
    status: p.status ?? "queued",
    scheduledAt: p.scheduled_at ? new Date(p.scheduled_at) : null,
    publishedAt: p.published_at ? new Date(p.published_at) : null,
    lastError: p.last_error ?? null,
    durationS: media.get(p.media_id)?.duration_s ?? null,
    thumbnailUrl: null,
  }));
  return {
    accounts: seed.accounts.map((a) => ({
      id: a.id ?? "",
      handle: a.handle,
      brand: brands.get(a.brand_id) ?? "",
      platform: a.platform,
      tags: a.tags ?? [],
      slots: a.slots ?? [],
      status: a.status ?? "ready",
      statusReason: a.status_reason ?? null,
      followers: a.followers ?? null,
    })),
    posts,
    metrics,
    now,
    timezone: seed.timezone,
  };
}

const iso = (d: Date | null) => d?.toISOString();

describe("buildCanvas on canvas-busy (Thu 5 Nov, 22:14 London)", () => {
  const model = buildCanvas(inputOf(seedOf("canvas-busy")));
  const col = (handle: string) => {
    const c = model.columns.find((x) => x.handle === handle);
    if (!c) throw new Error(`no column ${handle}`);
    return c;
  };

  it("has the five accounts in the order they were added", () => {
    expect(model.columns.map((c) => c.handle)).toEqual([
      "codingjourney",
      "trip.app",
      "ai.explained.daily",
      "tri.weekly",
      "driftship",
    ]);
  });

  it("stacks upcoming posts by time, next first, with a pin and the rest in the backlog", () => {
    const cj = col("codingjourney");
    expect(cj.upcoming.map((c) => [c.kind, iso(c.at)])).toEqual([
      ["scheduled", "2026-11-06T09:00:00.000Z"],
      ["scheduled", "2026-11-06T13:00:00.000Z"],
      ["pinned", "2026-11-06T19:00:00.000Z"],
      ["scheduled", "2026-11-07T09:00:00.000Z"],
    ]);
    expect(cj.backlog).toBe(10);
    expect(cj.moreInBacklog).toBe(6);
    expect(cj.next).toEqual({ kind: "next", at: new Date("2026-11-06T09:00:00Z") });
    expect(cj.profileUrl).toBe("https://www.instagram.com/codingjourney/");
  });

  it("fills the rest of a short queue with open slots", () => {
    const trip = col("trip.app");
    expect(trip.upcoming.map((c) => c.kind)).toEqual(["scheduled", "scheduled", "open", "open"]);
    expect(iso(trip.upcoming[2]?.at ?? null)).toBe("2026-11-07T12:00:00.000Z");
    expect(trip.moreInBacklog).toBe(0);
    expect(col("driftship").upcoming.map((c) => c.kind)).toEqual([
      "scheduled",
      "scheduled",
      "scheduled",
      "open",
    ]);
  });

  it("puts posted cards newest first, with stats, and a failed one with a short reason", () => {
    const trip = col("trip.app");
    expect(trip.posted).toHaveLength(5);
    const [first, second] = trip.posted;
    expect(first?.kind).toBe("failed");
    expect(first && "reason" in first ? first.reason : "").toBe("Wrong aspect ratio. Open to fix.");
    expect(iso(first?.at ?? null)).toBe("2026-11-05T18:30:00.000Z");
    expect(second?.kind).toBe("posted");
    expect(second && "views" in second ? second.views : 0).toBeGreaterThan(0);
    const times = trip.posted.map((p) => p.at.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("pauses the account that needs attention", () => {
    const tri = col("tri.weekly");
    expect(tri.status).toBe("needs_attention");
    expect(tri.next).toEqual({ kind: "paused" });
    expect(tri.upcoming.filter((c) => c.kind === "paused")).toHaveLength(3);
  });

  it("counts the top bar stats like the mockup", () => {
    expect(model.stats.scheduled).toBe(21);
    expect(model.stats.nextAt?.toISOString()).toBe("2026-11-06T08:00:00.000Z");
    expect(model.stats.postedToday).toBe(9);
    expect(model.stats.failed).toBe(1);
  });

  it("keeps only the last 7 days of posted cards", () => {
    const later = buildCanvas(inputOf(seedOf("canvas-busy"), new Date("2026-11-10T22:14:00Z")));
    const tri = later.columns.find((c) => c.handle === "tri.weekly");
    // tri.weekly posted at 07:00 on 1–5 Nov; on the 10th only 4 and 5 Nov are within 7 days.
    expect(tri?.posted.map((p) => p.at.toISOString())).toEqual([
      "2026-11-05T07:00:00.000Z",
      "2026-11-04T07:00:00.000Z",
    ]);
  });
});

describe("buildCanvas on empty", () => {
  it("shows one column with open slots and nothing queued", () => {
    const model = buildCanvas(inputOf(seedOf("empty")));
    expect(model.columns).toHaveLength(1);
    const [c] = model.columns;
    expect(c?.upcoming.map((u) => u.kind)).toEqual(["open", "open", "open", "open"]);
    expect(c?.next).toEqual({ kind: "none" });
    expect(c?.posted).toEqual([]);
    expect(model.stats).toEqual({ scheduled: 0, nextAt: null, postedToday: 0, failed: 0 });
  });

  it("shows no open slots for an account without slots", () => {
    const input = inputOf(seedOf("empty"));
    const model = buildCanvas({
      ...input,
      accounts: input.accounts.map((a) => ({ ...a, slots: [] })),
    });
    expect(model.columns[0]?.upcoming).toEqual([]);
  });
});

describe("helpers", () => {
  it("links profiles to the platform", () => {
    expect(profileUrl("instagram", "trip.app")).toBe("https://www.instagram.com/trip.app/");
    expect(profileUrl("fake", "@trip.app")).toBe("https://www.instagram.com/trip.app/");
    expect(profileUrl("tiktok", "codingjourney")).toBe("https://www.tiktok.com/@codingjourney");
  });

  it("picks a stable avatar colour 1–6 and initials", () => {
    const n = avatarIndex("some-id");
    expect(n).toBe(avatarIndex("some-id"));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(6);
    expect(initials("ai.explained.daily")).toBe("AI");
    expect(initials("123")).toBe("?");
  });

  it("shortens failure reasons to one line", () => {
    expect(failureSummary(null)).toBe("Publishing failed. Open to retry.");
    expect(failureSummary("Daily quota exhausted for this account.")).toBe(
      "Daily post limit reached.",
    );
    expect(failureSummary("Something odd happened. More detail here.")).toBe(
      "Something odd happened.",
    );
  });
});
