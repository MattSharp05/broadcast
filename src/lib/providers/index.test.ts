import { describe, expect, it } from "vitest";
import { createMemoryFakeStore } from "./fake";
import { ProviderError, providerFor } from "./index";

const deps = { fakeStore: createMemoryFakeStore(), now: () => new Date(0) };

describe("providerFor", () => {
  it("picks the fake provider for platform 'fake'", () => {
    expect(providerFor({ platform: "fake" }, deps).platform).toBe("fake");
  });

  it("has no Instagram provider yet (BC-9)", () => {
    expect(() => providerFor({ platform: "instagram" }, deps)).toThrow(ProviderError);
  });
});
