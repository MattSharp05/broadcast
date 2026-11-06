import { createFakeProvider, type FakeStore } from "./fake";
import { ProviderError, type ProviderPlatform, type SocialProvider } from "./types";

export * from "./types";

export interface ProviderDeps {
  /** State for the fake provider (createDbFakeStore with the service-role client). */
  fakeStore: FakeStore;
  /** The account's workspace clock (src/lib/clock.ts → nowFor). */
  now: () => Date;
}

/** The SocialProvider for an account's platform. Every platform call goes through this. */
export function providerFor(
  account: { platform: ProviderPlatform },
  deps: ProviderDeps,
): SocialProvider {
  switch (account.platform) {
    case "fake":
      return createFakeProvider({ store: deps.fakeStore, now: deps.now });
    case "instagram":
      // BC-9 adds the Instagram Graph API provider.
      throw new ProviderError({
        code: "unsupported",
        retryable: false,
        userMessage: "Instagram accounts can't be reached yet. Use a Sandbox account for now.",
      });
  }
}
