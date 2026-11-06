import { describe, expect, it } from "vitest";
import { isValidCronSecret } from "./secret";

describe("isValidCronSecret", () => {
  it("accepts the configured secret", () => {
    expect(isValidCronSecret("s3cret-value", "s3cret-value")).toBe(true);
  });

  it.each([
    ["wrong", "s3cret-value"],
    ["s3cret-valu", "s3cret-value"],
    ["", "s3cret-value"],
    [null, "s3cret-value"],
  ])("rejects %j", (given, expected) => {
    expect(isValidCronSecret(given, expected)).toBe(false);
  });

  it("accepts nothing when no secret is configured", () => {
    expect(isValidCronSecret("", "")).toBe(false);
    expect(isValidCronSecret("anything", undefined)).toBe(false);
  });
});
