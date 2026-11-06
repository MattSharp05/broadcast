import { stoppedReason } from "@/lib/domain/publish";
import { planQueue } from "@/lib/domain/queue";
import { stableUuid } from "@/lib/hash";
import { FAKE_PERMALINK_BASE, fakeUserId } from "@/lib/providers/fake";
import { emptySeed, type Scenario } from "./types";

const NAME = "post-failed";
const TIMEZONE = "Europe/London";
const HANDLE = "failed.posts";
const MINUTE_MS = 60_000;

/** Captions the e2e spec and QA look for. */
export const REJECTED_CAPTION = "Rejected: the video is 1080 × 1350";
export const LOST_CAPTION = "Lost answer: Instagram already has it";

export const ASPECT_MESSAGE =
  "Instagram rejected the video because it is 1080 × 1350. Reels must be 9:16 (1080 × 1920).";
export const NETWORK_MESSAGE =
  "Couldn't reach Instagram. Broadcast will try again in a few minutes.";

/** The lost-answer post's container: the fake provider already published it. */
export const LOST_CONTAINER = "fake_container_post_failed_lost";

/**
 * Two failed posts on one ready account (BC-20), with their attempts in the job log:
 * - REJECTED_CAPTION: Instagram rejected the 1080 × 1350 video (no container kept). Retry fails
 *   again; Replace video with a 9:16 file fixes it.
 * - LOST_CAPTION: the last three publish answers were lost, so it ended failed with its container
 *   kept, but the fake provider had published it. Retry checks the container and marks it posted
 *   without posting again; Replace video is refused until then.
 * Plus one post queued for the next slot.
 */
export const postFailed: Scenario = {
  name: NAME,
  description:
    "Two failed posts: a rejected 1080 × 1350 video, and one whose publish answer was lost (already live). Open them for Retry now, Replace video and Remove.",
  build: ({ now }) => {
    const seed = emptySeed(TIMEZONE);
    const brandId = stableUuid(NAME, "brand");
    const accountId = stableUuid(NAME, "account");
    const slots = ["09:00", "18:00"];
    const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE_MS).toISOString();
    seed.brands.push({ id: brandId, name: "Example brand" });
    seed.accounts.push({
      id: accountId,
      brand_id: brandId,
      platform: "fake",
      platform_user_id: fakeUserId(HANDLE),
      handle: HANDLE,
      profile_url: `${FAKE_PERMALINK_BASE}/${HANDLE}`,
      description: "Two posts failed: open them to retry, replace the video or remove.",
      tags: ["Example"],
      slots,
      status: "ready",
      followers: 860,
    });
    // aspect_ratio rejects only videos that aren't 9:16 (src/lib/providers/fake.ts).
    seed.fakeAccounts.push({
      account_id: accountId,
      ready_after_checks: 1,
      failure_mode: "aspect_ratio",
      failures_left: null,
    });

    const rejected = stableUuid(NAME, "post", "rejected");
    const lost = stableUuid(NAME, "post", "lost");
    const next = stableUuid(NAME, "post", "next");
    const media = (postId: string, width: number, height: number) => {
      const id = stableUuid(NAME, "media", postId);
      seed.media.push({
        id,
        storage_path: `sandbox/${NAME}/${postId}.mp4`,
        duration_s: 24,
        width,
        height,
        bytes: 9_000_000,
      });
      return id;
    };
    const log = (postId: string, minutesAgo: number, ok: boolean, message: string) => {
      seed.jobLog.push({
        kind: "publish",
        post_id: postId,
        account_id: accountId,
        ok,
        message,
        at: ago(minutesAgo),
      });
    };

    // Rejected: uploaded, then the container ended in an error (not retryable).
    seed.posts.push({
      id: rejected,
      account_id: accountId,
      media_id: media(rejected, 1080, 1350),
      caption: REJECTED_CAPTION,
      timing: "queue",
      queue_position: 0,
      scheduled_at: ago(42),
      status: "failed",
      attempts: 1,
      last_error: ASPECT_MESSAGE,
    });
    log(rejected, 42, true, "Uploaded the video (container fake_container_post_failed_rejected).");
    log(rejected, 41, false, `Failed: ${ASPECT_MESSAGE}`);

    // Lost answer: the fake published the container, but every answer after the upload was lost.
    const lostMedia = media(lost, 1080, 1920);
    const lostIgId = "fake_media_post_failed_lost";
    seed.fakeContainers.push({
      id: LOST_CONTAINER,
      account_id: accountId,
      video_url: `sandbox/${NAME}/${lost}.mp4`,
      caption: LOST_CAPTION,
      status_checks: 1,
      media_id: lostIgId,
      permalink: `${FAKE_PERMALINK_BASE}/${HANDLE}/reel/${lostIgId}`,
      published_at: ago(29),
    });
    seed.posts.push({
      id: lost,
      account_id: accountId,
      media_id: lostMedia,
      caption: LOST_CAPTION,
      timing: "pinned",
      scheduled_at: ago(30),
      status: "failed",
      container_id: LOST_CONTAINER,
      container_created_at: ago(30),
      attempts: 4,
      last_error: stoppedReason(NETWORK_MESSAGE),
    });
    log(lost, 30, true, `Uploaded the video (container ${LOST_CONTAINER}).`);
    log(lost, 29, false, `Retrying in 1 min: ${NETWORK_MESSAGE}`);
    log(lost, 28, false, `Retrying in 2 min: ${NETWORK_MESSAGE}`);
    log(lost, 26, false, `Retrying in 4 min: ${NETWORK_MESSAGE}`);
    log(lost, 22, false, `Failed after 3 retries: ${NETWORK_MESSAGE}`);

    const [planned] = planQueue({
      slots,
      timezone: TIMEZONE,
      now,
      posts: [{ id: next, timing: "queue", queuePosition: 1, status: "queued" }],
    });
    seed.posts.push({
      id: next,
      account_id: accountId,
      media_id: media(next, 1080, 1920),
      caption: "Next up: waits for its slot",
      timing: "queue",
      queue_position: 1,
      scheduled_at: planned?.scheduledAt?.toISOString() ?? null,
      status: "queued",
    });
    return seed;
  },
};
