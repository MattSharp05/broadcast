/** The tag filter shared by the Workflow and Accounts tabs. */

/** The filter value that shows every account (empty, so it never clashes with a real tag). */
export const ALL_TAGS = "";

/** Every tag used by the accounts, in first-seen order, without duplicates. */
export function tagsOf(accounts: readonly { tags: readonly string[] }[]): string[] {
  return [...new Set(accounts.flatMap((a) => a.tags))];
}

/** The accounts carrying `tag` (all of them for ALL_TAGS). */
export function filterByTag<T extends { tags: readonly string[] }>(
  accounts: readonly T[],
  tag: string,
): T[] {
  if (tag === ALL_TAGS) return [...accounts];
  return accounts.filter((a) => a.tags.includes(tag));
}

/** How many accounts carry each tag (for "Tech (2)" in the Accounts tab's Tag select). */
export function tagCounts(accounts: readonly { tags: readonly string[] }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of accounts) {
    for (const t of new Set(a.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

/** Longest tag and most tags an account may carry (checked again by the server action). */
export const TAG_MAX_LENGTH = 40;
export const TAGS_MAX = 12;

/** Suggested when adding a tag, after the ones already in use (PRD → Accounts tab). */
export const SUGGESTED_TAGS: readonly string[] = [
  "AI avatar",
  "App",
  "Explainers",
  "Tech",
  "Sport",
];

/** A typed tag tidied up: spaces collapsed and trimmed, cut to TAG_MAX_LENGTH. Empty → null. */
export function cleanTag(raw: string): string | null {
  const tag = raw.replace(/\s+/g, " ").trim().slice(0, TAG_MAX_LENGTH).trim();
  return tag === "" ? null : tag;
}

/**
 * The account's tags with `raw` added, or null when there is nothing to add (empty, already there
 * ignoring case, or the account already has TAGS_MAX tags). A tag other accounts already use
 * (`inUse`) keeps their spelling, so "tech" joins "Tech" instead of starting a second filter.
 */
export function addTag(
  tags: readonly string[],
  raw: string,
  inUse: readonly string[] = [],
): string[] | null {
  const typed = cleanTag(raw);
  if (!typed || tags.length >= TAGS_MAX) return null;
  const lower = typed.toLowerCase();
  if (tags.some((t) => t.toLowerCase() === lower)) return null;
  return [...tags, inUse.find((t) => t.toLowerCase() === lower) ?? typed];
}

/** The account's tags without `tag`. */
export function removeTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((t) => t !== tag);
}

/** A tag list as the server stores it: each cleaned, no duplicates (ignoring case), at most TAGS_MAX. */
export function cleanTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const t = cleanTag(r);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, TAGS_MAX);
}

/** Tags to suggest while adding one to an account: in-use first, then SUGGESTED_TAGS, minus its own. */
export function tagSuggestions(inUse: readonly string[], own: readonly string[]): string[] {
  const ownLower = new Set(own.map((t) => t.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...inUse, ...SUGGESTED_TAGS]) {
    const lower = t.toLowerCase();
    if (ownLower.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    out.push(t);
  }
  return out;
}
