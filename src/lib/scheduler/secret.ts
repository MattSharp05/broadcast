import { createHash, timingSafeEqual } from "node:crypto";

/** The header pg_cron sends with the shared secret (migration 0003 → schedule_tick). */
export const CRON_SECRET_HEADER = "x-cron-secret";

/**
 * True only when CRON_SECRET is set and the header matches it. Compared in constant time (on
 * hashes, so different lengths don't leak either). No secret configured: nothing is accepted.
 */
export function isValidCronSecret(
  given: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
