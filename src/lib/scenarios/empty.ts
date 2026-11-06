import { stableUuid } from "@/lib/hash";
import { FAKE_PERMALINK_BASE } from "@/lib/providers/fake";
import { emptySeed, type Scenario } from "./types";

const NAME = "empty";

/** One brand with one ready account and no posts at all. */
export const empty: Scenario = {
  name: NAME,
  description: "One brand with one ready account (two slots a day) and no posts.",
  build() {
    const seed = emptySeed("Europe/London");
    const brandId = stableUuid(NAME, "brand");
    const accountId = stableUuid(NAME, "account");
    seed.brands.push({ id: brandId, name: "Example brand" });
    seed.accounts.push({
      id: accountId,
      brand_id: brandId,
      platform: "fake",
      platform_user_id: "fake_user_example",
      handle: "example.account",
      profile_url: `${FAKE_PERMALINK_BASE}/example.account`,
      description: "An example account with nothing queued yet.",
      tags: ["Example"],
      slots: ["09:00", "18:00"],
      status: "ready",
      followers: 0,
    });
    seed.fakeAccounts.push({ account_id: accountId });
    return seed;
  },
};
