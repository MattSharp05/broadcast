import { planQueue, type PlannerPost } from "@/lib/domain/queue";
import { stableUuid } from "@/lib/hash";
import { FAKE_PERMALINK_BASE, fakeUserId, type FakeFailureMode } from "@/lib/providers/fake";
import { emptySeed, type SandboxSeed, type Scenario } from "./types";

const NAME = "token-expiring";
const TIMEZONE = "Europe/London";
const DAY_MS = 24 * 3_600_000;

/** What the fake provider stores instead of a token (it never reads one). */
export const SANDBOX_TOKEN_PLACEHOLDER = "sandbox-placeholder";

interface Spec {
  key: string;
  handle: string;
  description: string;
  slots: string[];
  queue: number;
  /** Days until the stored token expires. */
  expiresInDays: number;
  failureMode?: FakeFailureMode;
}

const ACCOUNTS: readonly Spec[] = [
  {
    key: "renews",
    handle: "codingjourney",
    description: "Its access expires in 3 days: the next tick renews it for another 60 days.",
    slots: ["09:00", "19:00"],
    queue: 3,
    expiresInDays: 3,
  },
  {
    key: "revoked",
    handle: "tri.weekly",
    description:
      "Its access expires in 2 days and Instagram refuses to renew it: the next tick marks it Needs attention and pauses its posts.",
    slots: ["07:00"],
    queue: 3,
    expiresInDays: 2,
    failureMode: "token_expired",
  },
];

/**
 * Two ready accounts whose Instagram access runs out within a week (BC-19). Run tick now on /dev:
 * @codingjourney's token is renewed; @tri.weekly's renewal is refused, so it needs attention and
 * its queued posts pause. Reconnect it from its drawer to bring them back.
 */
export const tokenExpiring: Scenario = {
  name: NAME,
  description:
    "Two accounts whose access expires this week. Run tick now on /dev: one renews, the other's renewal is refused, so it needs attention and its posts pause.",
  build({ now }): SandboxSeed {
    const seed = emptySeed(TIMEZONE);
    const id = (...parts: string[]) => stableUuid(NAME, ...parts);
    const brandId = id("brand");
    seed.brands.push({ id: brandId, name: "Coding Journey" });

    ACCOUNTS.forEach((spec, index) => {
      const accountId = id("account", spec.key);
      seed.accounts.push({
        id: accountId,
        created_at: new Date(now.getTime() - (10 - index) * DAY_MS).toISOString(),
        brand_id: brandId,
        platform: "fake",
        platform_user_id: fakeUserId(spec.handle),
        handle: spec.handle,
        profile_url: `${FAKE_PERMALINK_BASE}/${spec.handle}`,
        description: spec.description,
        tags: ["Example"],
        slots: spec.slots,
        status: "ready",
        followers: 900 + index * 400,
      });
      seed.fakeAccounts.push({
        account_id: accountId,
        failure_mode: spec.failureMode ?? null,
        failures_left: null,
      });
      seed.credentials.push({
        account_id: accountId,
        access_token_enc: SANDBOX_TOKEN_PLACEHOLDER,
        expires_at: new Date(now.getTime() + spec.expiresInDays * DAY_MS).toISOString(),
        last_refreshed_at: new Date(
          now.getTime() - (60 - spec.expiresInDays) * DAY_MS,
        ).toISOString(),
        scopes: ["fake_basic", "fake_content_publish", "fake_insights"],
      });

      const planner: PlannerPost[] = Array.from({ length: spec.queue }, (_, i) => ({
        id: id("post", spec.key, `${i}`),
        timing: "queue",
        queuePosition: i,
        status: "queued",
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
          duration_s: 30 + i,
          width: 1080,
          height: 1920,
          bytes: 11_000_000,
        });
        seed.posts.push({
          id: p.id,
          account_id: accountId,
          media_id: mediaId,
          caption: `${spec.handle}: queued video ${i + 1}`,
          timing: "queue",
          queue_position: i,
          scheduled_at: times.get(p.id)?.toISOString() ?? null,
          status: "queued",
        });
      });
    });
    return seed;
  },
};
