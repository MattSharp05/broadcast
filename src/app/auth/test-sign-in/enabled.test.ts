import { describe, expect, it } from "vitest";
import { testSignInEnabled } from "./enabled";

describe("testSignInEnabled", () => {
  it("is on with E2E=1 outside Vercel production", () => {
    expect(testSignInEnabled({ E2E: "1" })).toBe(true);
    expect(testSignInEnabled({ E2E: "1", VERCEL_ENV: "preview" })).toBe(true);
  });

  it("is off without E2E=1", () => {
    expect(testSignInEnabled({})).toBe(false);
    expect(testSignInEnabled({ E2E: "true" })).toBe(false);
  });

  it("is always off on Vercel production", () => {
    expect(testSignInEnabled({ E2E: "1", VERCEL_ENV: "production" })).toBe(false);
  });
});
