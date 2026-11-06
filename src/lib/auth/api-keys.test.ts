import { describe, expect, it } from "vitest";
import {
  apiKeyKind,
  apiKeyName,
  bearerToken,
  generateApiKey,
  hashApiKey,
  isApiKeyShape,
  sameHash,
} from "./api-keys";

describe("API keys", () => {
  it("are random, say their workspace and have the expected shape", () => {
    const a = generateApiKey("sandbox");
    const b = generateApiKey("sandbox");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^bc_sandbox_[A-Za-z0-9_-]{43}$/);
    expect(generateApiKey("live")).toMatch(/^bc_live_/);
    expect(isApiKeyShape(a)).toBe(true);
    expect(apiKeyKind(a)).toBe("sandbox");
  });

  it.each([
    [""],
    ["bc_sandbox_short"],
    ["bc_other_" + "a".repeat(43)],
    ["bc_live_" + "a".repeat(42) + "!"],
    [" bc_live_" + "a".repeat(43)],
  ])("rejects %j as a key", (value) => {
    expect(isApiKeyShape(value)).toBe(false);
    expect(apiKeyKind(value)).toBeNull();
  });

  it("hash to SHA-256 hex, never the key itself", () => {
    const key = "bc_live_" + "a".repeat(43);
    const hash = hashApiKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("aaaa");
    expect(hashApiKey(key)).toBe(hash);
    expect(hashApiKey(key + "b")).not.toBe(hash);
  });

  it("compare hashes in constant time and refuse malformed ones", () => {
    const hash = hashApiKey("x");
    expect(sameHash(hash, hashApiKey("x"))).toBe(true);
    expect(sameHash(hash, hashApiKey("y"))).toBe(false);
    expect(sameHash(hash, "")).toBe(false);
    expect(sameHash("zz", "zz")).toBe(false);
  });

  it.each([
    ["Bearer abc", "abc"],
    ["bearer abc", "abc"],
    ["Bearer   abc  ", "abc"],
    ["Basic abc", null],
    ["Bearer", null],
    ["Bearer a b", null],
    [null, null],
  ])("reads the bearer token of %j", (header, token) => {
    expect(bearerToken(header)).toBe(token);
  });

  it("names: trimmed, 1–60 characters", () => {
    expect(apiKeyName("  video-editor  ")).toBe("video-editor");
    expect(apiKeyName("")).toBeNull();
    expect(apiKeyName("x".repeat(61))).toBeNull();
    expect(apiKeyName(3)).toBeNull();
  });
});
