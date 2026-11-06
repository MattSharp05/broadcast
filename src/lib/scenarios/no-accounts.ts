import { emptySeed, type Scenario } from "./types";

/** A workspace before anything is set up: no brands, no accounts, no posts. */
export const noAccounts: Scenario = {
  name: "no-accounts",
  description: "Nothing set up yet: no brands, no accounts and no posts (the empty states).",
  build() {
    return emptySeed("Europe/London");
  },
};
