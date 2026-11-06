import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TokenDecryptError,
  TokenKeyError,
  credentialContext,
  decryptToken,
  encryptToken,
  parseTokenKey,
} from "./tokens";

// A key generated for this test run (never a real TOKEN_ENC_KEY).
const KEY = randomBytes(32);
const TOKEN = "IGAAT-example-long-lived-token-1234567890";

describe("token encryption (AES-256-GCM)", () => {
  it("round-trips, and the ciphertext doesn't contain the token", () => {
    const sealed = encryptToken(TOKEN, KEY, "ctx");
    expect(sealed).not.toContain(TOKEN);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(decryptToken(sealed, KEY, "ctx")).toBe(TOKEN);
  });

  it("uses a fresh IV each time", () => {
    expect(encryptToken(TOKEN, KEY)).not.toBe(encryptToken(TOKEN, KEY));
  });

  it("detects a tampered ciphertext, tag or IV", () => {
    const sealed = encryptToken(TOKEN, KEY);
    const parts = sealed.split(".");
    for (const i of [1, 2, 3]) {
      const tampered = [...parts];
      const bytes = Buffer.from(tampered[i] ?? "", "base64url");
      bytes[0] = (bytes[0] ?? 0) ^ 0x01;
      tampered[i] = bytes.toString("base64url");
      expect(() => decryptToken(tampered.join("."), KEY)).toThrow(TokenDecryptError);
    }
  });

  it("fails with another key", () => {
    const sealed = encryptToken(TOKEN, KEY);
    expect(() => decryptToken(sealed, randomBytes(32))).toThrow(TokenDecryptError);
  });

  it("binds the row: a token sealed for one account doesn't decrypt for another", () => {
    const sealed = encryptToken(TOKEN, KEY, credentialContext("account-a"));
    expect(() => decryptToken(sealed, KEY, credentialContext("account-b"))).toThrow(
      TokenDecryptError,
    );
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "v1", "v2.a.b.c", "v1.a.b", "plain-token"]) {
      expect(() => decryptToken(bad, KEY)).toThrow(TokenDecryptError);
    }
  });
});

describe("parseTokenKey", () => {
  it("accepts 32 bytes of base64", () => {
    expect(parseTokenKey(KEY.toString("base64"))).toEqual(KEY);
  });

  it.each([undefined, "", "  ", Buffer.alloc(16).toString("base64")])(
    "rejects %j with a clear message",
    (value) => {
      expect(() => parseTokenKey(value)).toThrow(TokenKeyError);
      expect(() => parseTokenKey(value)).toThrow(/TOKEN_ENC_KEY/);
    },
  );
});
