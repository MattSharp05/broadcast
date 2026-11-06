import { describe, expect, it } from "vitest";
import {
  CONNECT_MESSAGE_TYPE,
  CONNECT_RETURN_TTL_MS,
  encodeReturn,
  isConnectMessage,
  isReturnPath,
  parseReturn,
} from "./connect-message";

describe("isReturnPath", () => {
  it("accepts same-site paths only", () => {
    expect(isReturnPath("/accounts")).toBe(true);
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "accounts",
      null,
    ]) {
      expect(isReturnPath(bad), String(bad)).toBe(false);
    }
  });
});

describe("encodeReturn / parseReturn", () => {
  const now = Date.parse("2026-11-06T10:00:00Z");

  it("round-trips within the time limit", () => {
    expect(parseReturn(encodeReturn("/accounts", now), now + 60_000)).toBe("/accounts");
  });

  it("drops an expired, malformed or off-site return", () => {
    expect(parseReturn(encodeReturn("/accounts", now), now + CONNECT_RETURN_TTL_MS)).toBeNull();
    expect(parseReturn(null, now)).toBeNull();
    expect(parseReturn("/accounts", now)).toBeNull();
    expect(parseReturn(encodeReturn("//evil.example", now), now)).toBeNull();
  });
});

describe("isConnectMessage", () => {
  it("recognises the connect message only", () => {
    expect(
      isConnectMessage({ type: CONNECT_MESSAGE_TYPE, accountId: null, status: null, error: "x" }),
    ).toBe(true);
    expect(isConnectMessage({ type: "other" })).toBe(false);
    expect(isConnectMessage(null)).toBe(false);
  });
});
