import { planQueue } from "@/lib/domain/queue";
import { stableUuid } from "@/lib/hash";
import { FAKE_PERMALINK_BASE, fakeUserId } from "@/lib/providers/fake";
import { emptySeed, type Scenario } from "./types";

const NAME = "publish-due-now";
const HANDLE = "due.now";
const TIMEZONE = "Europe/London";
const MINUTE_MS = 60_000;

/** Caption of the post that is due; the e2e spec and QA look for it. */
export const DUE_CAPTION = "Due now: the scheduler posts this one";

/**
 * One ready account with a post that was due a minute ago and a second one queued for the next
 * slot. Two ticks publish the due post (the first uploads it, the second publishes it: the fake
 * container is ready on its first check); the other one stays queued.
 */
export const publishDueNow: Scenario = {
  name: NAME,
  description:
    "One account with a post due a minute ago. Run tick now twice on /dev: the first uploads it, the second publishes it.",
  build({ now }) {
    const seed = emptySeed(TIMEZONE);
    const brandId = stableUuid(NAME, "brand");
    const accountId = stableUuid(NAME, "account");
    const slots = ["09:00", "18:00"];
    seed.brands.push({ id: brandId, name: "Example brand" });
    seed.accounts.push({
      id: accountId,
      brand_id: brandId,
      platform: "fake",
      platform_user_id: fakeUserId(HANDLE),
      handle: HANDLE,
      profile_url: `${FAKE_PERMALINK_BASE}/${HANDLE}`,
      description: "A post is due now: run a tick to publish it.",
      tags: ["Example"],
      slots,
      status: "ready",
      followers: 1200,
    });
    seed.fakeAccounts.push({ account_id: accountId, ready_after_checks: 1 });

    const due = stableUuid(NAME, "post", "due");
    const next = stableUuid(NAME, "post", "next");
    for (const postId of [due, next]) {
      seed.media.push({
        id: stableUuid(NAME, "media", postId),
        storage_path: `sandbox/${NAME}/${postId}.mp4`,
        duration_s: 31,
        width: 1080,
        height: 1920,
        bytes: 12_000_000,
      });
    }
    const [planned] = planQueue({
      slots,
      timezone: TIMEZONE,
      now,
      posts: [{ id: next, timing: "queue", queuePosition: 1, status: "queued" }],
    });
    seed.posts.push(
      {
        id: due,
        account_id: accountId,
        media_id: stableUuid(NAME, "media", due),
        caption: DUE_CAPTION,
        timing: "queue",
        queue_position: 0,
        scheduled_at: new Date(now.getTime() - MINUTE_MS).toISOString(),
        status: "queued",
      },
      {
        id: next,
        account_id: accountId,
        media_id: stableUuid(NAME, "media", next),
        caption: "Next up: waits for its slot",
        timing: "queue",
        queue_position: 1,
        scheduled_at: planned?.scheduledAt?.toISOString() ?? null,
        status: "queued",
      },
    );
    return seed;
  },
};
