import type {
  PublishAction,
  PublishErrorCode,
  PublishOutcome,
  QuotaWait,
} from "@/lib/domain/publish";
import { ProviderError, type ProviderAccount, type SocialProvider } from "@/lib/providers";

/**
 * One publish step for one post: the provider calls for the action the publish machine chose
 * (src/lib/domain/publish.ts), described as a PublishOutcome. No database access, so the whole
 * publish flow can be unit tested against MSW fixtures tick by tick (publish-post.test.ts).
 */

export interface StepPost {
  id: string;
  handle: string;
  caption: string;
  /** When the post's current container was made (finds a post whose publish answer was lost). */
  containerCreatedAt: Date | null;
}

export interface StepInput {
  provider: SocialProvider;
  account: ProviderAccount;
  post: StepPost;
  action: PublishAction;
  /** The URL the platform downloads the video from (signed, for Instagram). */
  videoUrl: () => Promise<string>;
  /** When to try again if the publishing quota is used up (the account's next slot). */
  quotaWait: () => QuotaWait;
}

export const UNKNOWN_ERROR = "Something went wrong while posting. Broadcast will try again.";

/** A provider error (or anything thrown) as an outcome. */
export function errorOutcome(err: unknown, dropContainer = false): PublishOutcome {
  if (err instanceof ProviderError) {
    // Rate limiting and the platform's own "limit reached" answer: wait without using a retry.
    if (err.code === "quota_exhausted") return { kind: "quota_full", message: err.userMessage };
    if (err.code === "not_ready") return { kind: "processing" };
    return {
      kind: "error",
      code: err.code as PublishErrorCode,
      retryable: err.retryable,
      message: err.userMessage,
      dropContainer: dropContainer || err.code === "not_found",
    };
  }
  return { kind: "error", code: "unknown", retryable: true, message: UNKNOWN_ERROR };
}

/** Checks the account's publishing quota (CLAUDE.md → Rules). An outcome when it is used up. */
async function quotaFull(input: StepInput): Promise<PublishOutcome | null> {
  const quota = await input.provider.getPublishingQuota(input.account);
  if (quota.used < quota.limit) return null;
  return {
    kind: "quota_full",
    message: `@${input.post.handle} has used its ${quota.windowHours}-hour publishing limit (${quota.used} of ${quota.limit}). Posting resumes when it frees up.`,
    wait: input.quotaWait(),
  };
}

/** Runs the provider calls for one action and describes what happened. Never throws. */
export async function advancePost(input: StepInput): Promise<PublishOutcome | null> {
  const { provider, account, post, action } = input;
  try {
    switch (action.kind) {
      case "none":
        return null;
      case "pause":
        return { kind: "paused", reason: action.reason };
      case "create_container": {
        const full = await quotaFull(input);
        if (full) return full;
        const { containerId } = await provider.createReelContainer(account, {
          videoUrl: await input.videoUrl(),
          caption: post.caption,
        });
        return { kind: "container_created", containerId };
      }
      case "check_container": {
        const status = await provider.getContainerStatus(account, action.containerId);
        if (status.state === "in_progress") return { kind: "processing" };
        if (status.state === "error") return errorOutcome(status.error, true);
        // Already published (an earlier answer was lost): recover it; never publish again, and
        // no quota check, since it already counted.
        if (status.state === "finished") {
          const full = await quotaFull(input);
          if (full) return full;
        }
        const media = await provider.publishContainer(account, action.containerId, {
          caption: post.caption,
          containerCreatedAt: post.containerCreatedAt,
        });
        return { kind: "published", mediaId: media.mediaId, permalink: media.permalink };
      }
    }
  } catch (err) {
    if (!(err instanceof ProviderError)) console.error(`publishDue: post ${post.id}:`, err);
    return errorOutcome(err);
  }
}
