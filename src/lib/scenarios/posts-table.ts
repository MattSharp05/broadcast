import type { Json } from "@/lib/db/types";
import type { StatOffset } from "@/lib/domain/details";
import { buildRecipe } from "@/lib/domain/factory/recipe";
import { statDueAt } from "@/lib/domain/stats-schedule";
import { FAKE_PERMALINK_BASE } from "@/lib/providers/fake";
import { HOUR_MS, baseSeed } from "./factory";
import type { Scenario } from "./types";

const NAME = "posts-table";
const DAY_MS = 24 * HOUR_MS;

type Snap = Partial<Record<StatOffset, number>>;

interface PostSpec {
  key: string;
  account: "cj" | "maya";
  /** Null: an upload through Add content / the content API (no video, no recipe). */
  video: {
    title: string;
    idea: string;
    hook: string;
    genre: string;
    style: string;
    voice: string;
    music: string;
    tags: string[];
    routine: boolean;
  } | null;
  caption: string;
  /** Days ago it was posted; negative: scheduled that many days ahead. */
  daysAgo: number;
  /** Views per snapshot taken (likes and the rest follow from views). */
  views: Snap;
}

/** The posts, with fixed numbers so tests can check sorts and totals. */
export const POSTS_TABLE_POSTS: readonly PostSpec[] = [
  {
    key: "paris",
    account: "cj",
    video: {
      title: "Paris in 3 days for under €300",
      idea: "A three-day Paris plan that stays under €300, planned in Trip.",
      hook: "Paris for €300? Here's the plan.",
      genre: "explainer",
      style: "motion-graphics",
      voice: "design-m2",
      music: "floating-cities",
      tags: ["Trip"],
      routine: true,
    },
    caption: "Paris for €300? Here's the plan. #travel",
    daysAgo: 8,
    views: { "1h": 400, "24h": 5400, "7d": 9100 },
  },
  {
    key: "tokyo",
    account: "cj",
    video: {
      title: "Which Tokyo line is fastest?",
      idea: "A brainteaser: three routes across Tokyo, guess the fastest.",
      hook: "Three trains, one winner. Guess before the end.",
      genre: "brainteaser",
      style: "editorial-collage",
      voice: "design-f2",
      music: "wallpaper",
      tags: ["Trip"],
      routine: true,
    },
    caption: "Three trains, one winner. #tokyo",
    daysAgo: 2,
    views: { "1h": 90, "24h": 1200 },
  },
  {
    key: "budget",
    account: "maya",
    video: {
      title: "Budget a weekend trip in a minute",
      idea: "How to budget a weekend away with Trip's split view.",
      hook: "Stop guessing what a weekend away costs.",
      genre: "explainer",
      style: "motion-graphics",
      voice: "design-m2",
      music: "wallpaper",
      tags: ["Trip"],
      routine: false,
    },
    caption: "Stop guessing what a weekend away costs.",
    daysAgo: 1.5,
    views: { "1h": 60, "24h": 800 },
  },
  {
    key: "tides",
    account: "maya",
    video: {
      title: "How the moon causes tides",
      idea: "Why there are two high tides a day, with the moon's pull shown in 3D.",
      hook: "Two high tides a day. Here's why.",
      genre: "explainer",
      style: "realistic-3d",
      voice: "design-m2",
      music: "floating-cities",
      tags: [],
      routine: false,
    },
    caption: "Two high tides a day. Here's why.",
    daysAgo: 5,
    views: { "1h": 300, "24h": 3000, "48h": 4200 },
  },
  {
    key: "upload",
    account: "cj",
    video: null,
    caption: "Desk setup tour\nUploaded from the editor.",
    daysAgo: 4,
    views: { "1h": 20, "24h": 150 },
  },
  {
    key: "rome",
    account: "cj",
    video: {
      title: "Rome's best free viewpoints",
      idea: "Five free viewpoints in Rome, mapped in Trip.",
      hook: "The best views in Rome cost nothing.",
      genre: "list",
      style: "editorial-collage",
      voice: "design-f2",
      music: "floating-cities",
      tags: ["Trip"],
      routine: true,
    },
    caption: "The best views in Rome cost nothing.",
    daysAgo: -1,
    views: {},
  },
];

export const POSTS_TABLE_ROUTINE = "Trip weekend";

/** The videos the routine made (linked once routine seeding exists). */
export const POSTS_TABLE_ROUTINE_POSTS = POSTS_TABLE_POSTS.filter((p) => p.video?.routine).map(
  (p) => p.key,
);

/** The post's id in the scenario. */
export function postsTableId(key: string): string {
  return baseSeed(NAME, new Date(0)).id("post", key);
}

/**
 * The Posts tab (posts table, tags, genre): six posts on two accounts. Four are Content Factory
 * videos tagged "Trip" (three posted, one scheduled), three of them meant for the "Trip weekend"
 * routine; one is an untagged explainer; one is a plain upload with no recipe. Stats at 1 h,
 * 24 h and later where the post is old enough.
 */
export const postsTable: Scenario = {
  name: NAME,
  page: "/posts",
  description:
    "Posts tab: six posts on two accounts with genres, styles, voices, songs, a routine, the Trip tag and stats at several ages. Filter by Trip, sort by views, tag a post.",
  build: ({ now }) => {
    const { seed, id } = baseSeed(NAME, now);
    // The "Trip weekend" routine (paris, tokyo, rome) is added by the routines work: it seeds
    // routines after productions, so it links them with an update (ADR 0009).
    for (const spec of POSTS_TABLE_POSTS) {
      const postId = id("post", spec.key);
      const mediaId = id("media", spec.key);
      const accountId = id("account", spec.account);
      const handle = spec.account === "cj" ? "codingjourney" : "maya.explains";
      const when = new Date(now.getTime() - spec.daysAgo * DAY_MS);
      const iso = when.toISOString();
      const posted = spec.daysAgo > 0;
      const productionId = spec.video ? id("production", spec.key) : null;
      const v = spec.video;
      seed.media.push({
        id: mediaId,
        storage_path: `sandbox/${NAME}/${spec.key}.mp4`,
        duration_s: 42,
        width: 1080,
        height: 1920,
        bytes: 9_000_000,
        recipe:
          v && productionId
            ? (buildRecipe({
                productionId,
                style: v.style,
                avatarName: null,
                avatarVersion: null,
                faceModel: null,
                faceShare: null,
                voice: v.voice,
                music: v.music,
                hook: v.hook,
                scriptVersion: 1,
                series: null,
                costUsd: 0,
              }) as unknown as Json)
            : null,
      });
      const mediaIgId = `fake_media_${NAME}_${spec.key}`;
      const containerId = `fake_container_${NAME}_${spec.key}`;
      const permalink = `${FAKE_PERMALINK_BASE}/${handle}/reel/${mediaIgId}`;
      if (posted) {
        seed.fakeContainers.push({
          id: containerId,
          account_id: accountId,
          video_url: `sandbox://${NAME}/${spec.key}.mp4`,
          caption: spec.caption,
          status_checks: 1,
          media_id: mediaIgId,
          permalink,
          published_at: iso,
        });
      }
      seed.posts.push({
        id: postId,
        account_id: accountId,
        media_id: mediaId,
        caption: spec.caption,
        timing: posted ? "queue" : "pinned",
        scheduled_at: iso,
        status: posted ? "published" : "queued",
        attempts: posted ? 1 : 0,
        ...(posted
          ? { published_at: iso, container_id: containerId, media_ig_id: mediaIgId, permalink }
          : {}),
      });
      if (v && productionId) {
        seed.factory.productions.push({
          id: productionId,
          created_at: new Date(when.getTime() - DAY_MS).toISOString(),
          title: v.title,
          idea: v.idea,
          genre: v.genre,
          tags: v.tags,
          style: v.style,
          compare_styles: false,
          voice_key: v.voice,
          music_key: v.music,
          account_id: accountId,
          status: "scheduled",
          script: {
            version: 1,
            hook: v.hook,
            lines: [
              { id: "l1", text: v.hook, slot: "hook" },
              { id: "l2", text: v.idea },
              { id: "l3", text: "Follow for the next one." },
            ],
          },
          caption: spec.caption,
          media_id: mediaId,
          post_id: postId,
        });
      }
      for (const [offset, views] of Object.entries(spec.views) as [StatOffset, number][]) {
        const due = statDueAt(when, offset).toISOString();
        seed.postMetrics.push({
          id: id("metric", spec.key, offset),
          post_id: postId,
          stat_offset: offset,
          due_at: due,
          taken_at: due,
          views,
          reach: Math.round(views * 0.8),
          likes: Math.round(views * 0.05),
          comments: Math.round(views * 0.005),
          shares: Math.round(views * 0.01),
          saves: Math.round(views * 0.008),
        });
      }
    }
    return seed;
  },
};
