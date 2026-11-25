import { STAT_OFFSETS, type StatOffset } from "./details";

/**
 * The Posts tab (pure): one row per post with what the video is (title, idea, hook, script,
 * genre, style, voice, song, routine, tags) and how it did. Filtering, sorting, the stats-at
 * choice and the summary row all live here, shared by the page and its tests. The query is kept
 * in the URL (`?tag=Trip&sort=views&dir=desc&at=24h`) so a filtered view can be bookmarked.
 */

export const METRICS = ["views", "likes", "comments", "shares", "saves", "reach"] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_LABELS: Record<Metric, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  reach: "Reach",
};

/** "latest": each post's newest snapshot; an offset compares every post at the same age. */
export type StatAt = "latest" | StatOffset;
export const STAT_AT_OPTIONS: readonly { value: StatAt; label: string }[] = [
  { value: "latest", label: "Latest" },
  { value: "1h", label: "1 h" },
  { value: "6h", label: "6 h" },
  { value: "24h", label: "24 h" },
  { value: "48h", label: "48 h" },
  { value: "7d", label: "7 days" },
];

export type PostStatus = "queued" | "publishing" | "published" | "failed" | "paused";

/** The Status filter groups the post states the way the canvas words them. */
export type StatusFilter = "posted" | "scheduled" | "failed" | "paused";
export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "posted", label: "Posted" },
  { value: "scheduled", label: "Scheduled" },
  { value: "failed", label: "Failed" },
  { value: "paused", label: "Paused" },
];

export function statusGroup(status: PostStatus): StatusFilter {
  if (status === "published") return "posted";
  if (status === "failed") return "failed";
  if (status === "paused") return "paused";
  return "scheduled";
}

export const STATUS_LABELS: Record<PostStatus, string> = {
  queued: "Scheduled",
  publishing: "Posting",
  published: "Posted",
  failed: "Failed",
  paused: "Paused",
};

export type Counts = Record<Metric, number | null>;

export interface Snapshot {
  offset: StatOffset;
  /** ISO time the numbers were taken. */
  takenAt: string;
  values: Counts;
}

export interface PostRow {
  id: string;
  /** The Content Factory video it came from (null for Add content / content API uploads). */
  productionId: string | null;
  accountId: string;
  handle: string;
  status: PostStatus;
  /** ISO times. */
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  title: string;
  thumbnailUrl: string | null;
  idea: string;
  hook: string | null;
  script: string[];
  caption: string;
  permalink: string | null;
  genre: string | null;
  style: string | null;
  styleLabel: string | null;
  voice: string | null;
  voiceLabel: string | null;
  music: string | null;
  musicLabel: string | null;
  routineId: string | null;
  routineName: string | null;
  tags: string[];
  /** Taken snapshots (missed ones left out), any order. */
  snapshots: Snapshot[];
}

/** The post's numbers at `at`: the newest snapshot for "latest", else that offset's (or nulls). */
export function countsAt(row: Pick<PostRow, "snapshots">, at: StatAt): Counts | null {
  if (at === "latest") {
    let best: Snapshot | null = null;
    for (const s of row.snapshots) {
      if (
        !best ||
        STAT_OFFSETS.indexOf(s.offset) > STAT_OFFSETS.indexOf(best.offset) ||
        (s.offset === best.offset && s.takenAt > best.takenAt)
      )
        best = s;
    }
    return best?.values ?? null;
  }
  return row.snapshots.find((s) => s.offset === at)?.values ?? null;
}

export function metricAt(row: Pick<PostRow, "snapshots">, at: StatAt, metric: Metric) {
  return countsAt(row, at)?.[metric] ?? null;
}

// ───────────────────────────── query (URL state) ─────────────────────────────

export const FILTER_KEYS = [
  "q",
  "account",
  "routine",
  "genre",
  "style",
  "voice",
  "music",
  "tag",
  "status",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type Filters = Record<FilterKey, string>;

export const TEXT_SORTS = [
  "date",
  "title",
  "account",
  "status",
  "genre",
  "style",
  "voice",
  "music",
  "routine",
] as const;
export type SortKey = (typeof TEXT_SORTS)[number] | Metric;
export type SortDir = "asc" | "desc";

export interface TableQuery {
  filters: Filters;
  sort: SortKey;
  dir: SortDir;
  at: StatAt;
}

export function emptyFilters(): Filters {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])) as Filters;
}

export const DEFAULT_QUERY: TableQuery = {
  filters: emptyFilters(),
  sort: "date",
  dir: "desc",
  at: "latest",
};

export function isMetric(key: string): key is Metric {
  return (METRICS as readonly string[]).includes(key);
}

function isSortKey(key: string): key is SortKey {
  return isMetric(key) || (TEXT_SORTS as readonly string[]).includes(key);
}

/** The direction a column sorts in on its first click: numbers and dates biggest first. */
export function firstDir(key: SortKey): SortDir {
  return isMetric(key) || key === "date" ? "desc" : "asc";
}

type Params = Record<string, string | string[] | undefined>;

/** Reads the query from the URL's search params; anything unknown falls back to the default. */
export function parseQuery(params: Params | URLSearchParams): TableQuery {
  const get = (k: string): string => {
    if (params instanceof URLSearchParams) return params.get(k) ?? "";
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const filters = emptyFilters();
  for (const k of FILTER_KEYS) filters[k] = get(k).slice(0, 200);
  const sortRaw = get("sort");
  const sort: SortKey = isSortKey(sortRaw) ? sortRaw : DEFAULT_QUERY.sort;
  const dirRaw = get("dir");
  const dir: SortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : firstDir(sort);
  const atRaw = get("at");
  const at = STAT_AT_OPTIONS.find((o) => o.value === atRaw)?.value ?? "latest";
  return { filters, sort, dir, at };
}

/** The query as a search string ("" for the default view), defaults left out. */
export function queryString(q: TableQuery): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) if (q.filters[k]) p.set(k, q.filters[k]);
  if (q.sort !== DEFAULT_QUERY.sort) p.set("sort", q.sort);
  if (q.dir !== firstDir(q.sort)) p.set("dir", q.dir);
  if (q.at !== "latest") p.set("at", q.at);
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ───────────────────────────── filter, sort, summary ─────────────────────────────

function same(a: string | null, b: string): boolean {
  return (a ?? "").toLowerCase() === b.toLowerCase();
}

export function filterRows(rows: readonly PostRow[], f: Filters): PostRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q) {
      const hay = [r.title, r.idea, r.hook ?? "", r.caption, r.handle].join("\n").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.account && r.accountId !== f.account) return false;
    if (f.routine && r.routineId !== f.routine) return false;
    if (f.genre && !same(r.genre, f.genre)) return false;
    if (f.style && r.style !== f.style) return false;
    if (f.voice && r.voice !== f.voice) return false;
    if (f.music && r.music !== f.music) return false;
    if (f.tag && !r.tags.some((t) => same(t, f.tag))) return false;
    if (f.status && statusGroup(r.status) !== f.status) return false;
    return true;
  });
}

/** When the post went out, or will (newest first sorts on this). */
export function rowDate(r: PostRow): string {
  return r.publishedAt ?? r.scheduledAt ?? r.createdAt;
}

function textOf(r: PostRow, key: Exclude<SortKey, Metric>): string | null {
  switch (key) {
    case "date":
      return rowDate(r);
    case "title":
      return r.title || null;
    case "account":
      return r.handle;
    case "status":
      return STATUS_LABELS[r.status];
    case "genre":
      return r.genre;
    case "style":
      return r.styleLabel ?? r.style;
    case "voice":
      return r.voiceLabel ?? r.voice;
    case "music":
      return r.musicLabel ?? r.music;
    case "routine":
      return r.routineName;
  }
}

/** Sorted by `sort` in `dir`; empty values (no stats, no genre…) always last; ties newest first. */
export function sortRows(rows: readonly PostRow[], q: Pick<TableQuery, "sort" | "dir" | "at">) {
  const sign = q.dir === "asc" ? 1 : -1;
  const value = (r: PostRow): number | string | null =>
    isMetric(q.sort) ? metricAt(r, q.at, q.sort) : textOf(r, q.sort);
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) {
      const c =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), "en", { sensitivity: "base" });
      if (c !== 0) return c * sign;
    }
    return rowDate(b).localeCompare(rowDate(a));
  });
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

export interface Summary {
  posts: number;
  /** Posts with numbers at `at` (the totals and medians are over these). */
  withStats: number;
  totals: Counts;
  medians: Counts;
}

export function summarize(rows: readonly PostRow[], at: StatAt): Summary {
  const totals = {} as Counts;
  const medians = {} as Counts;
  let withStats = 0;
  const counts = rows.map((r) => countsAt(r, at));
  for (const c of counts) if (c) withStats++;
  for (const m of METRICS) {
    const values = counts.map((c) => c?.[m]).filter((v): v is number => typeof v === "number");
    totals[m] = values.length ? values.reduce((a, b) => a + b, 0) : null;
    const med = median(values);
    medians[m] = med === null ? null : Math.round(med);
  }
  return { posts: rows.length, withStats, totals, medians };
}

export interface Option {
  value: string;
  label: string;
}

/** The choices each filter offers: only values some post has, sorted by label. */
export function filterOptions(
  rows: readonly PostRow[],
): Record<Exclude<FilterKey, "q" | "status">, Option[]> {
  const collect = (pick: (r: PostRow) => Option[] | Option | null): Option[] => {
    const map = new Map<string, Option>();
    for (const r of rows) {
      const got = pick(r);
      for (const o of Array.isArray(got) ? got : got ? [got] : []) {
        const key = o.value.toLowerCase();
        if (!map.has(key)) map.set(key, o);
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "en"));
  };
  return {
    account: collect((r) => ({ value: r.accountId, label: `@${r.handle}` })),
    routine: collect((r) =>
      r.routineId ? { value: r.routineId, label: r.routineName ?? "Routine" } : null,
    ),
    genre: collect((r) => (r.genre ? { value: r.genre, label: r.genre } : null)),
    style: collect((r) => (r.style ? { value: r.style, label: r.styleLabel ?? r.style } : null)),
    voice: collect((r) => (r.voice ? { value: r.voice, label: r.voiceLabel ?? r.voice } : null)),
    music: collect((r) => (r.music ? { value: r.music, label: r.musicLabel ?? r.music } : null)),
    tag: collect((r) => r.tags.map((t) => ({ value: t, label: t }))),
  };
}

/** A post's title: the video's title, else the caption's first line, else "Untitled". */
export function rowTitle(title: string | null | undefined, caption: string): string {
  const t = title?.trim();
  if (t) return t;
  const first =
    caption
      .split("\n")
      .find((l) => l.trim())
      ?.trim() ?? "";
  return first ? first.slice(0, 80) : "Untitled";
}

/** Tags in either list, the first spelling kept, compared ignoring case. */
export function unionTags(a: readonly string[], b: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of [...a, ...b]) if (!out.some((o) => same(o, t))) out.push(t);
  return out;
}
