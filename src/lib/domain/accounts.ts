import type { AccountState } from "./canvas";
import { ALL_TAGS } from "./tags";

/**
 * The Accounts tab's table (docs/DESIGN.md → Layout → Accounts): rows grouped by brand, or
 * flattened when sorted by account or followers, filtered by search, tag and status. Pure: the
 * loader (src/lib/db/accounts.ts) reads the rows.
 */

export interface AccountRow {
  id: string;
  handle: string;
  platform: string;
  brandId: string;
  brand: string;
  tags: readonly string[];
  description: string;
  status: AccountState;
  statusReason: string | null;
  followers: number | null;
  slotsPerDay: number;
  /** Videos waiting to be posted (queued, paused or publishing). */
  backlog: number;
  profileUrl: string;
  /** 1–6: the --avatar-n colour. */
  avatar: number;
}

export interface BrandRef {
  id: string;
  name: string;
}

export interface BrandGroup {
  brand: BrandRef;
  accounts: AccountRow[];
}

export type SortKey = "handle" | "followers";
/** "brand": grouped by brand (the default). Otherwise one flat list. */
export type AccountSort = { key: "brand" } | { key: SortKey; dir: 1 | -1 };
export const DEFAULT_SORT: AccountSort = { key: "brand" };

export type StatusFilter = "all" | AccountState;

export interface AccountFilters {
  /** Matches handle, brand and description (any case). */
  query: string;
  /** A tag, or ALL_TAGS. */
  tag: string;
  status: StatusFilter;
}

export const NO_FILTERS: AccountFilters = { query: "", tag: ALL_TAGS, status: "all" };

export const STATUS_LABELS: Record<AccountState, string> = {
  ready: "Ready",
  needs_attention: "Needs attention",
  not_connected: "Not connected",
};

/** Longest description and brand name the server accepts. */
export const DESCRIPTION_MAX = 1000;
export const BRAND_NAME_MAX = 60;

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function hasFilters(f: AccountFilters): boolean {
  return f.query.trim() !== "" || f.tag !== ALL_TAGS || f.status !== "all";
}

export function filterAccounts(rows: readonly AccountRow[], f: AccountFilters): AccountRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter(
    (a) =>
      (f.tag === ALL_TAGS || a.tags.includes(f.tag)) &&
      (f.status === "all" || a.status === f.status) &&
      (!q || `${a.handle} ${a.brand} ${a.description}`.toLowerCase().includes(q)),
  );
}

function byHandle(a: AccountRow, b: AccountRow): number {
  return collator.compare(a.handle, b.handle) || collator.compare(a.platform, b.platform);
}

/** Flat order for a column sort; followers unknown sort last either way. */
export function sortAccounts(
  rows: readonly AccountRow[],
  sort: { key: SortKey; dir: 1 | -1 },
): AccountRow[] {
  return [...rows].sort((a, b) => {
    if (sort.key === "followers") {
      if (a.followers === null || b.followers === null) {
        if (a.followers === b.followers) return byHandle(a, b);
        return a.followers === null ? 1 : -1;
      }
      return (a.followers - b.followers) * sort.dir || byHandle(a, b);
    }
    return byHandle(a, b) * sort.dir;
  });
}

/**
 * Rows grouped by brand, brands by name and accounts by handle within each. `brands` adds
 * groups for brands without matching accounts (a brand just created); pass [] to leave them out.
 */
export function groupByBrand(
  rows: readonly AccountRow[],
  brands: readonly BrandRef[] = [],
): BrandGroup[] {
  const groups = new Map<string, BrandGroup>();
  for (const b of brands) groups.set(b.id, { brand: b, accounts: [] });
  for (const a of rows) {
    const g = groups.get(a.brandId);
    if (g) g.accounts.push(a);
    else groups.set(a.brandId, { brand: { id: a.brandId, name: a.brand }, accounts: [a] });
  }
  const list = [...groups.values()];
  for (const g of list) g.accounts.sort(byHandle);
  return list.sort((x, y) => collator.compare(x.brand.name, y.brand.name));
}

/**
 * What a click on a sortable header does: a new column sorts it (handle A–Z, followers most
 * first), the same column flips once, and a third click goes back to grouping by brand.
 */
export function nextSort(current: AccountSort, key: SortKey): AccountSort {
  const first: 1 | -1 = key === "followers" ? -1 : 1;
  if (current.key !== key) return { key, dir: first };
  if (current.dir === first) return { key, dir: first === 1 ? -1 : 1 };
  return DEFAULT_SORT;
}

export interface AccountStats {
  accounts: number;
  ready: number;
  attention: number;
}

export function accountStats(rows: readonly AccountRow[]): AccountStats {
  return {
    accounts: rows.length,
    ready: rows.filter((a) => a.status === "ready").length,
    attention: rows.filter((a) => a.status === "needs_attention").length,
  };
}

/**
 * The reason under the status word: the first sentence of the stored reason ("Instagram access
 * expired on 2 Nov."), which the drawer shows in full.
 */
export function shortReason(reason: string | null): string | null {
  const text = reason?.trim();
  if (!text) return null;
  const m = /^.*?[.!?](?=\s|$)/.exec(text);
  return m ? m[0] : text;
}

/** A brand name tidied up (spaces collapsed, cut to BRAND_NAME_MAX); empty → null. */
export function cleanBrandName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, BRAND_NAME_MAX).trim();
  return name === "" ? null : name;
}

/** A description as stored: trailing whitespace dropped, at most DESCRIPTION_MAX characters. */
export function cleanDescription(raw: string): string {
  return raw.slice(0, DESCRIPTION_MAX).trimEnd();
}

/** "1,240"; unknown followers show a dash. */
export function followersLabel(n: number | null): string {
  return n === null ? "–" : n.toLocaleString("en-GB");
}
