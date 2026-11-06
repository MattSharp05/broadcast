import { REQUIRED_PERMISSIONS } from "@/lib/domain/connect";
import { stableUuid } from "@/lib/hash";
import { FAKE_PERMALINK_BASE, fakeUserId } from "@/lib/providers/fake";
import { emptySeed, type Scenario } from "./types";

const NAME = "connect-missing-permission";
const HANDLE = "missing.permission";

/** The message an account gets when publishing wasn't allowed on the consent screen. */
const PUBLISHING_MISSING =
  REQUIRED_PERMISSIONS.find((p) => p.key === "publishing")?.missingMessage ?? "";

/**
 * A Sandbox account connected without the publishing permission: Needs attention, with the
 * reason. Reconnecting it (fake consent screen, user "missing.permission", everything allowed)
 * makes it Ready again, on the same account.
 */
export const connectMissingPermission: Scenario = {
  name: NAME,
  description:
    "One account connected without the publishing permission (needs attention). Reconnect it as missing.permission to fix it.",
  build() {
    const seed = emptySeed("Europe/London");
    const brandId = stableUuid(NAME, "brand");
    const accountId = stableUuid(NAME, "account");
    seed.brands.push({ id: brandId, name: "Example brand" });
    seed.accounts.push({
      id: accountId,
      brand_id: brandId,
      platform: "fake",
      platform_user_id: fakeUserId(HANDLE),
      handle: HANDLE,
      profile_url: `${FAKE_PERMALINK_BASE}/${HANDLE}`,
      description: "Connected, but publishing wasn't allowed.",
      tags: ["Example"],
      slots: ["09:00", "18:00"],
      status: "needs_attention",
      status_reason: PUBLISHING_MISSING,
      followers: 860,
    });
    seed.fakeAccounts.push({ account_id: accountId });
    return seed;
  },
};
