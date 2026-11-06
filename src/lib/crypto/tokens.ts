import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * OAuth token encryption at rest (ADR 0004): AES-256-GCM with TOKEN_ENC_KEY (32 random bytes,
 * base64). Server only: the key and the plaintext never reach the browser.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url parts; 12-byte IV, 16-byte tag). The optional
 * `context` is bound in as additional authenticated data, so a ciphertext only decrypts for the
 * row it was written for (callers pass the account id): swapping two rows' tokens fails.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class TokenKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenKeyError";
  }
}

/** Thrown when a ciphertext is malformed, was tampered with, or was written with another key. */
export class TokenDecryptError extends Error {
  constructor() {
    super("The stored token could not be decrypted (wrong key, other row, or tampered).");
    this.name = "TokenDecryptError";
  }
}

/** Parses a base64 TOKEN_ENC_KEY. Throws TokenKeyError when it is missing or not 32 bytes. */
export function parseTokenKey(value: string | null | undefined): Buffer {
  if (!value?.trim()) {
    throw new TokenKeyError(
      "TOKEN_ENC_KEY is not set. Generate one with `openssl rand -base64 32`.",
    );
  }
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    throw new TokenKeyError(
      `TOKEN_ENC_KEY must be ${KEY_BYTES} bytes, base64-encoded (got ${key.length} bytes).`,
    );
  }
  return key;
}

/** The key from the environment (TOKEN_ENC_KEY). */
export function tokenKeyFromEnv(): Buffer {
  return parseTokenKey(process.env.TOKEN_ENC_KEY);
}

/** True when TOKEN_ENC_KEY is set and valid. */
export function hasTokenKey(): boolean {
  try {
    tokenKeyFromEnv();
    return true;
  } catch {
    return false;
  }
}

export function encryptToken(plaintext: string, key: Buffer, context = ""): string {
  if (key.length !== KEY_BYTES) throw new TokenKeyError("The token key must be 32 bytes.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext].map((p) => (typeof p === "string" ? p : b64(p))).join(".");
}

export function decryptToken(sealed: string, key: Buffer, context = ""): string {
  if (key.length !== KEY_BYTES) throw new TokenKeyError("The token key must be 32 bytes.");
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new TokenDecryptError();
  const [, ivPart = "", tagPart = "", dataPart = ""] = parts;
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const data = Buffer.from(dataPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new TokenDecryptError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenDecryptError();
  }
}

/** The AAD context for an account's stored credentials. */
export function credentialContext(accountId: string): string {
  return `oauth_credentials:${accountId}`;
}

function b64(buf: Buffer): string {
  return buf.toString("base64url");
}
