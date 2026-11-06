import { openSlots, planQueue, type PlannerPost } from "@/lib/domain/queue";
import { addDays, toLocalDate } from "@/lib/domain/time";
import { stableUuid } from "@/lib/hash";
import { FAKE_PERMALINK_BASE, fakeInsights, type FakeFailureMode } from "@/lib/providers/fake";
import { isoDay, pastSlotTimes } from "./slots";
import { emptySeed, type Scenario, type SandboxSeed } from "./types";

const NAME = "canvas-busy";
const TIMEZONE = "Europe/London";
const HOUR_MS = 3_600_000;
const STAT_OFFSETS = [
  ["1h", 1],
  ["6h", 6],
  ["24h", 24],
  ["48h", 48],
  ["7d", 168],
] as const;

const TITLES = {
  code: [
    "Day 41: three builders in parallel",
    "What a PRD interview with Claude looks like",
    "My Notion ticket board, explained",
    "The hook that stops me pushing to main",
    "Cloud vs local Claude sessions",
    "How I QA a batch of tickets in 20 minutes",
    "Shipping a kart racer in a weekend",
    "Why every ticket has a test matrix",
    "Reading a session's token bill",
  ],
  app: [
    "Plan a weekend away in 30 seconds",
    "Trip's new globe view",
    "Flight delays, handled for you",
    "Packing lists that fill themselves",
    "Share a trip with friends in one tap",
    "How Trip picks restaurants",
    "Offline maps for the whole trip",
    "Trip now does road trips",
  ],
  ai: [
    "What is a context window?",
    "RAG in 45 seconds",
    "Agents vs workflows",
    "Why models hallucinate",
    "Tokens, explained with Lego",
    "Fine-tuning vs prompting",
    "What an embedding is",
    "How AI reads a PDF",
  ],
  sport: [
    "Brick session: 40 km bike and 5 km run",
    "Open-water sighting drill",
    "Race-week taper, day by day",
    "Transition practice in my garage",
    "Zone 2: what it actually feels like",
    "Fuelling a half-Ironman",
  ],
  app2: [
    "Launch a store in a day with Driftship",
    "Driftship: auto-sourced products",
    "Page tips that convert",
    "From idea to first sale",
    "New storefront themes",
    "Pricing your first product",
  ],
} as const;

interface AccountSpec {
  key: string;
  handle: string;
  brand: string;
  tags: string[];
  description: string;
  followers: number;
  theme: keyof typeof TITLES;
  slots: string[];
  /** Posts in the backlog (queue). */
  queue: number;
  /** Index of the upcoming slot taken by a pinned post. */
  pinnedSlot?: number;
  needsAttention?: boolean;
  /** Most recent past post failed (Instagram rejected it). */
  lastFailed?: boolean;
  failureMode?: FakeFailureMode;
}

/** The five accounts of the approved mockup (docs/vision-mockup.html). */
const ACCOUNTS: readonly AccountSpec[] = [
  {
    key: "cj",
    handle: "codingjourney",
    brand: "Coding Journey",
    tags: ["Tech", "Build in public"],
    description:
      "Daily notes from building apps with Claude: what shipped, what broke, what I learnt.",
    followers: 1240,
    theme: "code",
    slots: ["09:00", "13:00", "19:00"],
    queue: 9,
    pinnedSlot: 2,
  },
  {
    key: "trip",
    handle: "trip.app",
    brand: "Trip",
    tags: ["App", "Product"],
    description: "Short demos of Trip, the travel planner: feature drops, how-tos and real trips.",
    followers: 312,
    theme: "app",
    slots: ["12:00", "18:30"],
    queue: 2,
    lastFailed: true,
  },
  {
    key: "ai",
    handle: "ai.explained.daily",
    brand: "Explainers",
    tags: ["AI avatar", "Explainers", "Tech"],
    description: "An AI-avatar host explains one AI idea a day in under a minute.",
    followers: 5410,
    theme: "ai",
    slots: ["08:00", "17:00"],
    queue: 6,
  },
  {
    key: "tri",
    handle: "tri.weekly",
    brand: "Sport",
    tags: ["Sport"],
    description: "Training for a half-Ironman: sessions, kit and what race week really looks like.",
    followers: 860,
    theme: "sport",
    slots: ["07:00"],
    queue: 3,
    needsAttention: true,
    failureMode: "token_expired",
  },
  {
    key: "drift",
    handle: "driftship",
    brand: "Driftship",
    tags: ["App", "Explainers"],
    description: "How to launch and grow an online store with Driftship, one tip at a time.",
    followers: 2090,
    theme: "app2",
    slots: ["10:00", "20:00"],
    queue: 3,
  },
];

const ASPECT_ERROR =
  "Instagram rejected the video because it is 1080 × 1350. Reels must be 9:16 (1080 × 1920). Tried 3 times.";

function dayLabel(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: timezone })
    .format(date)
    .replace(".", "");
}

/**
 * The busy Workflow of the mockup: 5 accounts in 5 brands with tags and slots, queues (one pinned
 * post), posted history with stats, one failed post (@trip.app) and one account needing attention
 * (@tri.weekly, expired access; its queue is paused).
 */
export const canvasBusy: Scenario = {
  name: NAME,
  description:
    "Five accounts in five brands with queues, a pinned post, posted history with stats, one failed post and one account needing attention.",
  build({ now, rng }): SandboxSeed {
    const seed = emptySeed(TIMEZONE);
    const id = (...parts: string[]) => stableUuid(NAME, ...parts);

    for (const spec of ACCOUNTS) {
      const brandId = id("brand", spec.brand);
      const accountId = id("account", spec.key);
      const titles = TITLES[spec.theme];
      let titleIndex = 0;
      const nextTitle = () => titles[titleIndex++ % titles.length] ?? spec.handle;

      seed.brands.push({ id: brandId, name: spec.brand });
      seed.accounts.push({
        id: accountId,
        brand_id: brandId,
        platform: "fake",
        platform_user_id: `fake_user_${spec.key}`,
        handle: spec.handle,
        profile_url: `${FAKE_PERMALINK_BASE}/${spec.handle}`,
        description: spec.description,
        tags: spec.tags,
        slots: spec.slots,
        status: spec.needsAttention ? "needs_attention" : "ready",
        status_reason: spec.needsAttention
          ? `Instagram access expired on ${dayLabel(new Date(now.getTime() - 3 * 24 * HOUR_MS), TIMEZONE)}. Reconnect to resume posting.`
          : null,
        followers: spec.followers,
      });
      seed.fakeAccounts.push({
        account_id: accountId,
        failure_mode: spec.failureMode ?? null,
        failures_left: null,
      });

      const addMedia = (postId: string, deletedAt: string | null) => {
        const mediaId = id("media", postId);
        seed.media.push({
          id: mediaId,
          storage_path: `sandbox/${NAME}/${postId}.mp4`,
          duration_s: 24 + Math.floor(rng() * 35),
          width: 1080,
          height: 1920,
          bytes: 8_000_000 + Math.floor(rng() * 20_000_000),
          deleted_at: deletedAt,
        });
        return mediaId;
      };

      // Upcoming: the backlog, timed by the queue planner, plus an optional pinned post.
      const planner: PlannerPost[] = [];
      const status = spec.needsAttention ? "paused" : "queued";
      if (spec.pinnedSlot !== undefined) {
        const pinAt = openSlots({
          slots: spec.slots,
          timezone: TIMEZONE,
          now,
          posts: [],
          count: spec.pinnedSlot + 1,
        })[spec.pinnedSlot];
        if (pinAt) {
          const postId = id("post", spec.key, "pinned");
          planner.push({ id: postId, timing: "pinned", scheduledAt: pinAt, status });
          seed.posts.push({
            id: postId,
            account_id: accountId,
            media_id: addMedia(postId, null),
            caption: nextTitle(),
            timing: "pinned",
            scheduled_at: pinAt.toISOString(),
            status,
          });
        }
      }
      const queued = Array.from({ length: spec.queue }, (_, i) =>
        id("post", spec.key, "q", `${i}`),
      );
      queued.forEach((postId, i) =>
        planner.push({ id: postId, timing: "queue", queuePosition: i, status }),
      );
      const times = new Map(
        planQueue({ slots: spec.slots, timezone: TIMEZONE, now, posts: planner }).map((p) => [
          p.id,
          p.scheduledAt,
        ]),
      );
      queued.forEach((postId, i) => {
        seed.posts.push({
          id: postId,
          account_id: accountId,
          media_id: addMedia(postId, null),
          caption: nextTitle(),
          timing: "queue",
          queue_position: i,
          scheduled_at: times.get(postId)?.toISOString() ?? null,
          status,
        });
      });

      // Posted: the five most recent slots, newest first.
      pastSlotTimes(spec.slots, TIMEZONE, now, 5).forEach((at, i) => {
        const postId = id("post", spec.key, "past", `${i}`);
        const iso = at.toISOString();
        if (spec.lastFailed && i === 0) {
          seed.posts.push({
            id: postId,
            account_id: accountId,
            media_id: addMedia(postId, null),
            caption: nextTitle(),
            timing: "queue",
            scheduled_at: iso,
            status: "failed",
            attempts: 3,
            last_error: ASPECT_ERROR,
          });
          seed.jobLog.push({
            kind: "publish",
            post_id: postId,
            account_id: accountId,
            ok: false,
            message: ASPECT_ERROR,
            at: new Date(at.getTime() + 7 * 60_000).toISOString(),
          });
          return;
        }
        const mediaIgId = `fake_media_${spec.key}_${i}`;
        const containerId = `fake_container_${spec.key}_${i}`;
        const permalink = `${FAKE_PERMALINK_BASE}/${spec.handle}/reel/${mediaIgId}`;
        const caption = nextTitle();
        seed.fakeContainers.push({
          id: containerId,
          account_id: accountId,
          video_url: `sandbox://${NAME}/${postId}.mp4`,
          caption,
          status_checks: 2,
          media_id: mediaIgId,
          permalink,
          published_at: iso,
        });
        seed.posts.push({
          id: postId,
          account_id: accountId,
          media_id: addMedia(postId, iso),
          caption,
          timing: "queue",
          scheduled_at: iso,
          status: "published",
          container_id: containerId,
          media_ig_id: mediaIgId,
          permalink,
          attempts: 1,
          published_at: iso,
        });
        for (const [offset, hours] of STAT_OFFSETS) {
          const due = new Date(at.getTime() + hours * HOUR_MS);
          const taken = due <= now;
          seed.postMetrics.push({
            id: id("metric", postId, offset),
            post_id: postId,
            stat_offset: offset,
            due_at: due.toISOString(),
            ...(taken
              ? { taken_at: due.toISOString(), ...fakeInsights(mediaIgId, spec.followers, hours) }
              : {}),
          });
        }
      });

      // Followers over the last 14 days, ending at today's count.
      let followers = spec.followers;
      const today = toLocalDate(now, TIMEZONE);
      for (let d = 0; d < 14; d++) {
        seed.accountMetrics.push({
          account_id: accountId,
          day: isoDay(addDays(today, -d)),
          followers,
        });
        followers = Math.max(0, followers - Math.floor(rng() * (spec.followers / 60 + 3)));
      }
    }
    return seed;
  },
};
