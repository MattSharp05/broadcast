import { describe, expect, it } from "vitest";
import { createMemoryFakeStore } from "./fake";
import { ProviderError, providerFor } from "./index";

const deps = { fakeStore: createMemoryFakeStore(), now: () => new Date(0) };

describe("providerFor", () => {
  it("picks the fake provider for platform 'fake'", () => {
    expect(providerFor({ platform: "fake" }, deps).platform).toBe("fake");
  });

  it("picks the Instagram provider when the app is configured", () => {
    const ig = providerFor(
      { platform: "instagram" },
      { ...deps, instagram: { appId: "1", appSecret: "s" } },
    );
    expect(ig.platform).toBe("instagram");
  });

  it("fails clearly for Instagram without IG_APP_ID/IG_APP_SECRET", () => {
    expect(() => providerFor({ platform: "instagram" }, deps)).toThrow(ProviderError);
    expect(() => providerFor({ platform: "instagram" }, deps)).toThrow(/IG_APP_ID/);
  });
});
