import { planQueue } from "@/lib/domain/queue";
import { stableUuid } from "@/lib/hash";
import { FAKE_PERMALINK_BASE, fakeUserId } from "@/lib/providers/fake";
import type { FakeFailureMode } from "@/lib/providers/fake";
import { emptySeed, type SandboxSeed, type Scenario } from "./types";

const NAME = "publish-due-now";
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
  build: ({ now }) => dueSeed({ name: NAME, handle: "due.now", now }),
};

/**
 * The publish-due-now set-up, for publishing scenarios: one ready Sandbox account (slots 09:00 and
 * 18:00, London) with DUE_CAPTION due a minute ago and a second post queued for the next slot.
 * `failure` sets the fake provider's failure mode for the account (every call).
 */
export function dueSeed(input: {
  name: string;
  handle: string;
  now: Date;
  description?: string;
  failure?: FakeFailureMode;
}): SandboxSeed {
  const { name, handle, now } = input;
  const seed = emptySeed(TIMEZONE);
  const brandId = stableUuid(name, "brand");
  const accountId = stableUuid(name, "account");
  const slots = ["09:00", "18:00"];
  seed.brands.push({ id: brandId, name: "Example brand" });
  seed.accounts.push({
    id: accountId,
    brand_id: brandId,
    platform: "fake",
    platform_user_id: fakeUserId(handle),
    handle: handle,
    profile_url: `${FAKE_PERMALINK_BASE}/${handle}`,
    description: input.description ?? "A post is due now: run a tick to publish it.",
    tags: ["Example"],
    slots,
    status: "ready",
    followers: 1200,
  });
  seed.fakeAccounts.push({
    account_id: accountId,
    ready_after_checks: 1,
    failure_mode: input.failure ?? null,
    failures_left: null,
  });

  const due = stableUuid(name, "post", "due");
  const next = stableUuid(name, "post", "next");
  for (const postId of [due, next]) {
    seed.media.push({
      id: stableUuid(name, "media", postId),
      storage_path: `sandbox/${name}/${postId}.mp4`,
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
      media_id: stableUuid(name, "media", due),
      caption: DUE_CAPTION,
      timing: "queue",
      queue_position: 0,
      scheduled_at: new Date(now.getTime() - MINUTE_MS).toISOString(),
      status: "queued",
    },
    {
      id: next,
      account_id: accountId,
      media_id: stableUuid(name, "media", next),
      caption: "Next up: waits for its slot",
      timing: "queue",
      queue_position: 1,
      scheduled_at: planned?.scheduledAt?.toISOString() ?? null,
      status: "queued",
    },
  );
  return seed;
}
