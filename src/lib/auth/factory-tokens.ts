import { randomBytes } from "node:crypto";
import type { WorkspaceKind } from "@/lib/db/workspaces";
import { hashApiKey } from "./api-keys";

/**
 * Factory tokens (pure): what a Claude session working on one video uses for the factory API and
 * the generation proxy. Scoped to one production, expiring, stored as a SHA-256 hash only. Not
 * the content API key, and never a provider key.
 *
 * Shape: `bcf_<live|sandbox>_<43 random characters>`.
 */

const PATTERN = /^bcf_(live|sandbox)_[A-Za-z0-9_-]{43}$/;
/** Long enough for a render with avatar clips; a new fire mints a new one. */
export const FACTORY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function generateFactoryToken(kind: WorkspaceKind): string {
  return `bcf_${kind}_${randomBytes(32).toString("base64url")}`;
}

export function isFactoryTokenShape(value: string): boolean {
  return PATTERN.test(value);
}

export function factoryTokenKind(token: string): WorkspaceKind | null {
  const m = PATTERN.exec(token);
  return m ? (m[1] as WorkspaceKind) : null;
}

export const hashFactoryToken = hashApiKey;
