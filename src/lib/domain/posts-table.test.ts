import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY,
  countsAt,
  emptyFilters,
  filterOptions,
  filterRows,
  median,
  parseQuery,
  queryString,
  rowTitle,
  sortRows,
  summarize,
  unionTags,
  type Counts,
  type PostRow,
} from "./posts-table";

const counts = (views: number | null, likes: number | null = null): Counts => ({
  views,
  likes,
  comments: null,
  shares: null,
  saves: null,
  reach: null,
});

function row(id: string, over: Partial<PostRow> = {}): PostRow {
  return {
    id,
    productionId: null,
    accountId: "a1",
    handle: "maya.explains",
    status: "published",
    scheduledAt: null,
    publishedAt: `2026-11-0${id.length}T10:00:00Z`,
    createdAt: "2026-11-01T00:00:00Z",
    title: `Video ${id}`,
    thumbnailUrl: null,
    idea: "",
    hook: null,
    script: [],
    caption: "",
    permalink: null,
    genre: null,
    style: null,
    styleLabel: null,
    voice: null,
    voiceLabel: null,
    music: null,
    musicLabel: null,
    routineId: null,
    routineName: null,
    tags: [],
    snapshots: [],
    ...over,
  };
}

describe("countsAt", () => {
  const r = row("x", {
    snapshots: [
      { offset: "1h", takenAt: "2026-11-01T11:00:00Z", values: counts(10) },
      { offset: "24h", takenAt: "2026-11-02T10:00:00Z", values: counts(300) },
      { offset: "6h", takenAt: "2026-11-01T16:00:00Z", values: counts(80) },
    ],
  });
  it("latest is the newest offset", () => {
    expect(countsAt(r, "latest")?.views).toBe(300);
  });
  it("an offset gives that snapshot", () => {
    expect(countsAt(r, "6h")?.views).toBe(80);
  });
  it("a missing offset is null", () => {
    expect(countsAt(r, "7d")).toBeNull();
  });
});

describe("filterRows", () => {
  const rows = [
    row("a", { tags: ["Trip"], genre: "explainer", caption: "Moon tides" }),
    row("bb", { tags: ["trip", "AI"], genre: "brainteaser", accountId: "a2", status: "queued" }),
    row("ccc", { genre: "explainer", routineId: "r1" }),
  ];
  it("tag ignores case", () => {
    expect(filterRows(rows, { ...emptyFilters(), tag: "TRIP" }).map((r) => r.id)).toEqual([
      "a",
      "bb",
    ]);
  });
  it("combines filters", () => {
    const f = { ...emptyFilters(), genre: "explainer", routine: "r1" };
    expect(filterRows(rows, f).map((r) => r.id)).toEqual(["ccc"]);
  });
  it("status groups queued as scheduled", () => {
    expect(filterRows(rows, { ...emptyFilters(), status: "scheduled" }).map((r) => r.id)).toEqual([
      "bb",
    ]);
  });
  it("searches the caption", () => {
    expect(filterRows(rows, { ...emptyFilters(), q: "tides" }).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("sortRows", () => {
  const rows = [
    row("a", { snapshots: [{ offset: "24h", takenAt: "x", values: counts(50) }] }),
    row("bb", { snapshots: [] }),
    row("ccc", { snapshots: [{ offset: "24h", takenAt: "x", values: counts(900) }] }),
  ];
  it("metric descending, no stats last", () => {
    const sorted = sortRows(rows, { sort: "views", dir: "desc", at: "24h" });
    expect(sorted.map((r) => r.id)).toEqual(["ccc", "a", "bb"]);
  });
  it("ascending still keeps no stats last", () => {
    const sorted = sortRows(rows, { sort: "views", dir: "asc", at: "24h" });
    expect(sorted.map((r) => r.id)).toEqual(["a", "ccc", "bb"]);
  });
  it("date newest first by default", () => {
    expect(sortRows(rows, DEFAULT_QUERY).map((r) => r.id)).toEqual(["ccc", "bb", "a"]);
  });
});

describe("summarize", () => {
  it("totals and medians over posts with numbers", () => {
    const s = summarize(
      [
        row("a", { snapshots: [{ offset: "1h", takenAt: "x", values: counts(10, 1) }] }),
        row("b", { snapshots: [{ offset: "1h", takenAt: "x", values: counts(30, null) }] }),
        row("c"),
      ],
      "latest",
    );
    expect(s.posts).toBe(3);
    expect(s.withStats).toBe(2);
    expect(s.totals.views).toBe(40);
    expect(s.medians.views).toBe(20);
    expect(s.totals.likes).toBe(1);
    expect(s.totals.shares).toBeNull();
  });
  it("median of an odd and empty list", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
});

describe("query", () => {
  it("round-trips through the URL", () => {
    const q = parseQuery(new URLSearchParams("tag=Trip&sort=views&at=24h"));
    expect(q.filters.tag).toBe("Trip");
    expect(q.dir).toBe("desc");
    expect(queryString(q)).toBe("?tag=Trip&sort=views&at=24h");
  });
  it("ignores unknown values", () => {
    const q = parseQuery({ sort: "nope", at: "3d", dir: "up" });
    expect(q.sort).toBe("date");
    expect(q.at).toBe("latest");
    expect(queryString(q)).toBe("");
  });
  it("keeps a non-default direction", () => {
    expect(queryString({ ...DEFAULT_QUERY, sort: "title", dir: "desc" })).toBe(
      "?sort=title&dir=desc",
    );
  });
});

describe("helpers", () => {
  it("rowTitle falls back to the caption's first line", () => {
    expect(rowTitle("", "\nHow tides work\nmore")).toBe("How tides work");
    expect(rowTitle(null, "")).toBe("Untitled");
  });
  it("unionTags keeps one spelling", () => {
    expect(unionTags(["Trip"], ["trip", "AI"])).toEqual(["Trip", "AI"]);
  });
  it("filterOptions lists each tag once", () => {
    const o = filterOptions([row("a", { tags: ["Trip"] }), row("b", { tags: ["trip", "AI"] })]);
    expect(o.tag.map((t) => t.value)).toEqual(["AI", "Trip"]);
  });
});
