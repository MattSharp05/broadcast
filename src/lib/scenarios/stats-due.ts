import { STAT_OFFSETS } from "@/lib/domain/details";
import { statDueAt } from "@/lib/domain/stats-schedule";
import { addDays, toLocalDate } from "@/lib/domain/time";
import { stableUuid } from "@/lib/hash";
import { FAKE_PERMALINK_BASE, fakeInsights, fakeUserId } from "@/lib/providers/fake";
import { isoDay } from "./slots";
import { emptySeed, type Scenario } from "./types";

const NAME = "stats-due";
const TIMEZONE = "Europe/London";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const STATS_DUE_FOLLOWERS = 1200;

/** The two posts: published 65 minutes ago (1 h snapshot due) and 50 hours ago (catch-up). */
export const STATS_DUE_POSTS = {
  fresh: { key: "fresh", ageMs: 65 * MINUTE_MS, caption: "Posted an hour ago: 1 h stats due" },
  behind: {
    key: "behind",
    ageMs: 50 * HOUR_MS,
    caption: "Stats fell behind: 48 h due, 6 h and 24 h missed",
  },
} as const;

/** The fake media id of a stats-due post (its insights come from fakeInsights). */
export function statsDueMediaId(key: string): string {
  return `fake_media_${NAME}_${key}`;
}

/**
 * Stats collection (BC-21). One ready account whose follower count hasn't been taken today, with
 * two published posts: one posted 65 minutes ago (its 1 h snapshot is due) and one posted 50 hours
 * ago with only its 1 h snapshot taken (the scheduler was "down": 6 h and 24 h are overdue, 48 h is
 * due). One Run tick now fills the 1 h snapshot, the 48 h one (6 h and 24 h marked missed) and
 * today's followers.
 */
export const statsDue: Scenario = {
  name: NAME,
  description:
    "Two posted Reels with stats due (one 1 h, one catching up after downtime) and today's followers not yet taken. Run tick now on /dev: the card's views fill in.",
  build: ({ now }) => {
    const seed = emptySeed(TIMEZONE);
    const handle = "stats.due";
    const brandId = stableUuid(NAME, "brand");
    const accountId = stableUuid(NAME, "account");
    seed.brands.push({ id: brandId, name: "Example brand" });
    seed.accounts.push({
      id: accountId,
      brand_id: brandId,
      platform: "fake",
      platform_user_id: fakeUserId(handle),
      handle,
      profile_url: `${FAKE_PERMALINK_BASE}/${handle}`,
      description: "Stats are due: run a tick to collect them.",
      tags: ["Example"],
      slots: ["09:00", "18:00"],
      status: "ready",
      followers: STATS_DUE_FOLLOWERS,
    });
    seed.fakeAccounts.push({ account_id: accountId, failure_mode: null, failures_left: null });

    for (const spec of Object.values(STATS_DUE_POSTS)) {
      const postId = stableUuid(NAME, "post", spec.key);
      const mediaId = stableUuid(NAME, "media", spec.key);
      const mediaIgId = statsDueMediaId(spec.key);
      const containerId = `fake_container_${NAME}_${spec.key}`;
      const permalink = `${FAKE_PERMALINK_BASE}/${handle}/reel/${mediaIgId}`;
      const publishedAt = new Date(now.getTime() - spec.ageMs);
      const iso = publishedAt.toISOString();
      seed.media.push({
        id: mediaId,
        storage_path: `sandbox/${NAME}/${postId}.mp4`,
        duration_s: 28,
        width: 1080,
        height: 1920,
        bytes: 11_000_000,
        deleted_at: iso,
      });
      seed.fakeContainers.push({
        id: containerId,
        account_id: accountId,
        video_url: `sandbox://${NAME}/${postId}.mp4`,
        caption: spec.caption,
        status_checks: 1,
        media_id: mediaIgId,
        permalink,
        published_at: iso,
      });
      seed.posts.push({
        id: postId,
        account_id: accountId,
        media_id: mediaId,
        caption: spec.caption,
        timing: "queue",
        scheduled_at: iso,
        status: "published",
        container_id: containerId,
        media_ig_id: mediaIgId,
        permalink,
        attempts: 1,
        published_at: iso,
      });
      for (const offset of STAT_OFFSETS) {
        const due = statDueAt(publishedAt, offset);
        // The older post had its 1 h snapshot taken on time; nothing after that.
        const taken = spec.key === "behind" && offset === "1h";
        seed.postMetrics.push({
          id: stableUuid(NAME, "metric", spec.key, offset),
          post_id: postId,
          stat_offset: offset,
          due_at: due.toISOString(),
          ...(taken
            ? {
                taken_at: due.toISOString(),
                ...fakeInsights(mediaIgId, STATS_DUE_FOLLOWERS, 1),
              }
            : {}),
        });
      }
    }

    // Followers for the 13 days before today; today's comes from the tick.
    const today = toLocalDate(now, TIMEZONE);
    for (let d = 1; d <= 13; d++) {
      seed.accountMetrics.push({
        account_id: accountId,
        day: isoDay(addDays(today, -d)),
        followers: STATS_DUE_FOLLOWERS - d * 7,
      });
    }
    return seed;
  },
};
