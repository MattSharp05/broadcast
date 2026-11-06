import { planQueue, type PlannerPost } from "@/lib/domain/queue";
import { stableUuid } from "@/lib/hash";
import { FAKE_PERMALINK_BASE, fakeUserId } from "@/lib/providers/fake";
import { emptySeed, type SandboxSeed, type Scenario } from "./types";

const NAME = "add-content";
const TIMEZONE = "Europe/London";
const HOUR_MS = 3_600_000;

interface Spec {
  key: string;
  handle: string;
  brand: string;
  slots: string[];
  /** Posts already in the backlog. */
  queue: number;
  needsAttention?: boolean;
}

/** Every case the Add content dialog's account list shows. */
const ACCOUNTS: readonly Spec[] = [
  {
    key: "busy",
    handle: "codingjourney",
    brand: "Coding Journey",
    slots: ["09:00", "13:00", "19:00"],
    queue: 2,
  },
  { key: "empty", handle: "trip.app", brand: "Trip", slots: ["12:00", "18:30"], queue: 0 },
  {
    key: "paused",
    handle: "tri.weekly",
    brand: "Sport",
    slots: ["07:00"],
    queue: 1,
    needsAttention: true,
  },
  { key: "noslots", handle: "driftship", brand: "Driftship", slots: [], queue: 0 },
];

/**
 * Four accounts for adding videos: @codingjourney (3 slots, 2 queued), @trip.app (2 slots, empty
 * backlog), @tri.weekly (needs attention: new posts wait, paused) and @driftship (no slots yet:
 * new posts wait in the backlog without a time).
 */
export const addContent: Scenario = {
  name: NAME,
  description:
    "Four accounts for Add content: a busy queue, an empty one, a paused account and one with no slots yet.",
  build({ now }): SandboxSeed {
    const seed = emptySeed(TIMEZONE);
    const id = (...parts: string[]) => stableUuid(NAME, ...parts);
    ACCOUNTS.forEach((spec, index) => {
      const brandId = id("brand", spec.key);
      const accountId = id("account", spec.key);
      seed.brands.push({ id: brandId, name: spec.brand });
      seed.accounts.push({
        id: accountId,
        created_at: new Date(now.getTime() - (10 - index) * 24 * HOUR_MS).toISOString(),
        brand_id: brandId,
        platform: "fake",
        platform_user_id: fakeUserId(spec.handle),
        handle: spec.handle,
        profile_url: `${FAKE_PERMALINK_BASE}/${spec.handle}`,
        description: "",
        tags: [],
        slots: spec.slots,
        status: spec.needsAttention ? "needs_attention" : "ready",
        status_reason: spec.needsAttention
          ? "Instagram access expired. Reconnect to resume posting."
          : null,
        followers: 1000,
      });
      seed.fakeAccounts.push({ account_id: accountId, failure_mode: null, failures_left: null });

      const status = spec.needsAttention ? "paused" : "queued";
      const planner: PlannerPost[] = Array.from({ length: spec.queue }, (_, i) => ({
        id: id("post", spec.key, `${i}`),
        timing: "queue",
        queuePosition: i,
        status,
      }));
      const times = new Map(
        planQueue({ slots: spec.slots, timezone: TIMEZONE, now, posts: planner }).map((p) => [
          p.id,
          p.scheduledAt,
        ]),
      );
      planner.forEach((p, i) => {
        const mediaId = id("media", p.id);
        seed.media.push({
          id: mediaId,
          storage_path: `sandbox/${NAME}/${p.id}.mp4`,
          duration_s: 30,
          width: 1080,
          height: 1920,
          bytes: 9_000_000,
        });
        seed.posts.push({
          id: p.id,
          account_id: accountId,
          media_id: mediaId,
          caption: `Already queued ${i + 1}`,
          timing: "queue",
          queue_position: i,
          scheduled_at: times.get(p.id)?.toISOString() ?? null,
          status,
        });
      });
    });
    return seed;
  },
};
