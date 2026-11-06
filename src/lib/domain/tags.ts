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
