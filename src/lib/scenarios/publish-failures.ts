import { dueSeed } from "./publish-due-now";
import type { Scenario } from "./types";

/**
 * Publishing when Instagram says no (BC-16), on the fake provider. Same set-up as publish-due-now
 * (DUE_CAPTION due a minute ago), with the account's failure mode set.
 */

/** The account has used its 24-hour publishing limit: the due post waits for the next slot. */
export const publishQuotaExhausted: Scenario = {
  name: "publish-quota-exhausted",
  description:
    "A post is due, but the account has used its 24-hour publishing limit. Run tick now on /dev: nothing is uploaded and the post waits for the next slot.",
  build: ({ now }) =>
    dueSeed({
      name: "publish-quota-exhausted",
      handle: "quota.full",
      now,
      description: "Has used its 24-hour publishing limit.",
      failure: "quota_exhausted",
    }),
};

/** Instagram ends the upload in an error (wrong aspect ratio): the post fails with the reason. */
export const publishContainerError: Scenario = {
  name: "publish-container-error",
  description:
    "A post is due whose video Instagram rejects (1080 × 1350). Run tick now twice on /dev: it uploads, then fails with the reason. Replace video with a 9:16 file fixes it.",
  build: ({ now }) =>
    dueSeed({
      name: "publish-container-error",
      handle: "wrong.shape",
      now,
      description: "Its next video is 1080 × 1350, not 9:16.",
      failure: "aspect_ratio",
      dueSize: { width: 1080, height: 1350 },
    }),
};
