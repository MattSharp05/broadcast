import { describe, expect, it } from "vitest";
import { configuredAppOrigin } from "./app-url";

describe("configuredAppOrigin", () => {
  it("prefers APP_URL, then Vercel's production domain, else null", () => {
    expect(
      configuredAppOrigin({
        APP_URL: "https://broadcast.example/",
        VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app",
      }),
    ).toBe("https://broadcast.example");
    expect(configuredAppOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })).toBe(
      "https://x.vercel.app",
    );
    expect(configuredAppOrigin({ APP_URL: "  " })).toBeNull();
    expect(configuredAppOrigin({})).toBeNull();
  });
});
