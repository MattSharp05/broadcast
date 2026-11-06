import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  NO_FILTERS,
  accountStats,
  cleanBrandName,
  cleanDescription,
  filterAccounts,
  followersLabel,
  groupByBrand,
  hasFilters,
  nextSort,
  shortReason,
  sortAccounts,
  type AccountRow,
} from "./accounts";

function row(over: Partial<AccountRow> & Pick<AccountRow, "id" | "handle" | "brand">): AccountRow {
  return {
    platform: "fake",
    brandId: `b-${over.brand}`,
    tags: [],
    description: "",
    status: "ready",
    statusReason: null,
    followers: 0,
    slotsPerDay: 2,
    backlog: 0,
    profileUrl: `https://www.instagram.com/${over.handle}/`,
    avatar: 1,
    ...over,
  };
}

// The mockup's five accounts, in the order they were added.
const ROWS: AccountRow[] = [
  row({
    id: "cj",
    handle: "codingjourney",
    brand: "Coding Journey",
    tags: ["Tech", "Build in public"],
    description: "Daily notes from building apps",
    followers: 1240,
  }),
  row({ id: "trip", handle: "trip.app", brand: "Trip", tags: ["App", "Product"], followers: 312 }),
  row({
    id: "ai",
    handle: "ai.explained.daily",
    brand: "Explainers",
    tags: ["AI avatar", "Explainers", "Tech"],
    followers: 5410,
  }),
  row({
    id: "tri",
    handle: "tri.weekly",
    brand: "Sport",
    tags: ["Sport"],
    status: "needs_attention",
    statusReason: "Instagram access expired on 2 Nov. Reconnect to resume posting.",
    followers: 860,
  }),
  row({
    id: "drift",
    handle: "driftship",
    brand: "Driftship",
    tags: ["App", "Explainers"],
    followers: 2090,
  }),
];
const ids = (rows: readonly AccountRow[]) => rows.map((r) => r.id);

describe("filterAccounts", () => {
  it("keeps everything without filters", () => {
    expect(filterAccounts(ROWS, NO_FILTERS)).toHaveLength(5);
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it("searches handle, brand and description, any case", () => {
    expect(ids(filterAccounts(ROWS, { ...NO_FILTERS, query: "TRIP" }))).toEqual(["trip"]);
    expect(ids(filterAccounts(ROWS, { ...NO_FILTERS, query: "explainers" }))).toEqual(["ai"]);
    expect(ids(filterAccounts(ROWS, { ...NO_FILTERS, query: " building apps " }))).toEqual(["cj"]);
    expect(hasFilters({ ...NO_FILTERS, query: "x" })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, query: "  " })).toBe(false);
  });

  it("filters by tag and status together", () => {
    expect(ids(filterAccounts(ROWS, { ...NO_FILTERS, tag: "App" }))).toEqual(["trip", "drift"]);
    expect(ids(filterAccounts(ROWS, { ...NO_FILTERS, status: "needs_attention" }))).toEqual([
      "tri",
    ]);
    expect(filterAccounts(ROWS, { ...NO_FILTERS, tag: "App", status: "needs_attention" })).toEqual(
      [],
    );
  });
});

describe("groupByBrand", () => {
  it("groups by brand name A–Z, accounts by handle", () => {
    const extra = row({ id: "cj2", handle: "codingjourney.clips", brand: "Coding Journey" });
    const groups = groupByBrand([extra, ...ROWS]);
    expect(groups.map((g) => g.brand.name)).toEqual([
      "Coding Journey",
      "Driftship",
      "Explainers",
      "Sport",
      "Trip",
    ]);
    expect(ids(groups[0]?.accounts ?? [])).toEqual(["cj", "cj2"]);
  });

  it("adds brands without accounts when given", () => {
    const groups = groupByBrand(ROWS.slice(0, 1), [{ id: "b-new", name: "Kart Racer" }]);
    expect(groups.map((g) => [g.brand.name, g.accounts.length])).toEqual([
      ["Coding Journey", 1],
      ["Kart Racer", 0],
    ]);
  });
});

describe("sorting", () => {
  it("sorts by handle and followers (unknown last)", () => {
    expect(ids(sortAccounts(ROWS, { key: "handle", dir: 1 }))).toEqual([
      "ai",
      "cj",
      "drift",
      "tri",
      "trip",
    ]);
    expect(ids(sortAccounts(ROWS, { key: "handle", dir: -1 }))).toEqual([
      "trip",
      "tri",
      "drift",
      "cj",
      "ai",
    ]);
    const withNull = [...ROWS, row({ id: "new", handle: "new", brand: "X", followers: null })];
    expect(ids(sortAccounts(withNull, { key: "followers", dir: -1 }))).toEqual([
      "ai",
      "drift",
      "cj",
      "tri",
      "trip",
      "new",
    ]);
    expect(ids(sortAccounts(withNull, { key: "followers", dir: 1 }))).toEqual([
      "trip",
      "tri",
      "cj",
      "drift",
      "ai",
      "new",
    ]);
  });

  it("cycles a header: first direction, flipped, then back to brands", () => {
    let s = nextSort(DEFAULT_SORT, "followers");
    expect(s).toEqual({ key: "followers", dir: -1 });
    s = nextSort(s, "followers");
    expect(s).toEqual({ key: "followers", dir: 1 });
    expect(nextSort(s, "followers")).toEqual(DEFAULT_SORT);
    expect(nextSort(s, "handle")).toEqual({ key: "handle", dir: 1 });
  });
});

describe("helpers", () => {
  it("counts accounts, ready and needing attention", () => {
    expect(accountStats(ROWS)).toEqual({ accounts: 5, ready: 4, attention: 1 });
    expect(accountStats([])).toEqual({ accounts: 0, ready: 0, attention: 0 });
  });

  it("keeps the first sentence of a reason", () => {
    expect(shortReason("Instagram access expired on 2 Nov. Reconnect to resume posting.")).toBe(
      "Instagram access expired on 2 Nov.",
    );
    expect(shortReason("Waiting for TikTok's review")).toBe("Waiting for TikTok's review");
    expect(shortReason("  ")).toBeNull();
    expect(shortReason(null)).toBeNull();
  });

  it("tidies brand names and descriptions", () => {
    expect(cleanBrandName("  Kart   Racer ")).toBe("Kart Racer");
    expect(cleanBrandName("   ")).toBeNull();
    expect(cleanBrandName("x".repeat(80))).toHaveLength(60);
    expect(cleanDescription("Line one\nline two  \n")).toBe("Line one\nline two");
    expect(cleanDescription("y".repeat(1200))).toHaveLength(1000);
  });

  it("formats followers", () => {
    expect(followersLabel(5410)).toBe("5,410");
    expect(followersLabel(0)).toBe("0");
    expect(followersLabel(null)).toBe("–");
  });
});
