import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { WorkspaceKind } from "@/lib/db/workspaces";

/**
 * Content API keys (ADR 0005, BC-17). Pure: no database.
 *
 * A key reads `bc_<live|sandbox>_<43 random characters>` (32 random bytes, base64url), so it is
 * easy to spot in a config file and says which workspace it posts to. Only its SHA-256 hash is
 * stored (`api_keys.key_hash`); the key itself is shown once, when it is created.
 */

const KEY_PATTERN = /^bc_(live|sandbox)_[A-Za-z0-9_-]{43}$/;

/** A new random key for a workspace. */
export function generateApiKey(kind: WorkspaceKind): string {
  return `bc_${kind}_${randomBytes(32).toString("base64url")}`;
}

/** True when `value` looks like a key this app made (checked before any database call). */
export function isApiKeyShape(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** The workspace kind a well-formed key names, or null. */
export function apiKeyKind(key: string): WorkspaceKind | null {
  const m = KEY_PATTERN.exec(key);
  return m ? (m[1] as WorkspaceKind) : null;
}

/** SHA-256 of the key, hex: what `api_keys.key_hash` stores. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Constant-time comparison of two hex hashes. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header ?? "");
  return m?.[1] ?? null;
}

/** The name a key is listed under: trimmed, 1–60 characters. Null when unusable. */
export function apiKeyName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 60 ? name : null;
}
