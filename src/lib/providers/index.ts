import { createFakeProvider, type FakeStore } from "./fake";
import {
  INSTAGRAM_NOT_CONFIGURED_MESSAGE,
  createInstagramProvider,
  type InstagramConfig,
} from "./instagram";
import { ProviderError, type ProviderPlatform, type SocialProvider } from "./types";

export * from "./types";

export interface ProviderDeps {
  /** State for the fake provider (createDbFakeStore with the service-role client). */
  fakeStore: FakeStore;
  /** The account's workspace clock (src/lib/clock.ts → nowFor). */
  now: () => Date;
  /** The Meta app (instagramConfigFromEnv); null or absent when IG_APP_ID/SECRET/IG_LOGIN_CONFIG_ID aren't all set. */
  instagram?: InstagramConfig | null;
  /** Per-request timeout for platform calls (default 15 s); the tick passes what its budget allows. */
  timeoutMs?: number;
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
      if (!deps.instagram) {
        throw new ProviderError({
          code: "unsupported",
          retryable: false,
          userMessage: INSTAGRAM_NOT_CONFIGURED_MESSAGE,
        });
      }
      return createInstagramProvider({
        config: deps.instagram,
        now: deps.now,
        timeoutMs: deps.timeoutMs,
      });
  }
}
