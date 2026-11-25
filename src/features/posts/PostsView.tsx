"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  Play,
  Search,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { Select } from "@/components/Select";
import { Tag } from "@/components/Tag";
import { Toast } from "@/components/Toast";
import type { ActionResult } from "@/features/accounts/table/actions";
import { genreLabel } from "@/lib/domain/genres";
import { statCount, whenLabel } from "@/lib/domain/format";
import {
  DEFAULT_QUERY,
  METRICS,
  METRIC_LABELS,
  STATUS_FILTERS,
  STATUS_LABELS,
  STAT_AT_OPTIONS,
  countsAt,
  emptyFilters,
  filterOptions,
  filterRows,
  firstDir,
  queryString,
  rowDate,
  sortRows,
  summarize,
  type FilterKey,
  type PostRow,
  type SortKey,
  type StatAt,
  type TableQuery,
} from "@/lib/domain/posts-table";
import styles from "./posts.module.css";

export interface PostsViewProps {
  rows: PostRow[];
  initialQuery: TableQuery;
  /** The workspace clock (ISO). */
  now: string;
  timezone: string;
  tagPosts: (
    postIds: string[],
    tag: string,
    op: "add" | "remove",
  ) => Promise<ActionResult<Record<string, string[]>>>;
}

/** Checkbox, video, account, status, genre, style, voice, song, routine, tags, hook, metrics. */
const COLUMNS = 11 + METRICS.length;

const SELECTS: readonly { key: Exclude<FilterKey, "q" | "status">; label: string; all: string }[] =
  [
    { key: "account", label: "Account", all: "All accounts" },
    { key: "routine", label: "Routine", all: "All routines" },
    { key: "genre", label: "Genre", all: "All genres" },
    { key: "style", label: "Style", all: "All styles" },
    { key: "voice", label: "Voice", all: "All voices" },
    { key: "music", label: "Song", all: "All songs" },
    { key: "tag", label: "Tag", all: "All tags" },
  ];

function SortHeader({
  label,
  sortKey,
  query,
  onSort,
  numeric,
}: {
  label: string;
  sortKey: SortKey;
  query: TableQuery;
  onSort: (key: SortKey) => void;
  numeric?: boolean;
}) {
  const active = query.sort === sortKey ? query.dir : null;
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <th
      className={numeric ? styles.num : undefined}
      aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        className={styles.sort}
        data-active={active ? "" : undefined}
        onClick={() => {
          onSort(sortKey);
        }}
      >
        {label}
        <Icon aria-hidden="true" />
      </button>
    </th>
  );
}

function Dash() {
  return <span className={styles.muted}>—</span>;
}

/** The Posts tab: toolbar of filters, a bulk tag bar, the summary row and one row per post. */
export function PostsView({
  rows: initialRows,
  initialQuery,
  now,
  timezone,
  tagPosts,
}: PostsViewProps) {
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [tagText, setTagText] = useState("");
  const [toast, setToast] = useState<{ message: string; id: number; error?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const clock = useMemo(() => new Date(now), [now]);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  // Keep the URL in step, so the filtered view can be bookmarked and shared.
  useEffect(() => {
    const url = `${window.location.pathname}${queryString(query)}`;
    if (url !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", url);
    }
  }, [query]);

  const options = useMemo(() => filterOptions(rows), [rows]);
  const shown = useMemo(() => sortRows(filterRows(rows, query.filters), query), [rows, query]);
  const summary = useMemo(() => summarize(shown, query.at), [shown, query.at]);
  const allTags = options.tag.map((o) => o.value);
  const filtered = Object.values(query.filters).some(Boolean);
  const selectedShown = shown.filter((r) => selected.has(r.id));

  const setFilter = (key: FilterKey, value: string) => {
    setQuery((q) => ({ ...q, filters: { ...q.filters, [key]: value } }));
  };
  const onSort = (key: SortKey) => {
    setQuery((q) =>
      q.sort === key
        ? { ...q, dir: q.dir === "asc" ? "desc" : "asc" }
        : { ...q, sort: key, dir: firstDir(key) },
    );
  };
  const toggle = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const showToast = useCallback((message: string, error = false) => {
    setToast({ message, id: Date.now(), error });
  }, []);

  const applyTag = (op: "add" | "remove") => {
    const ids = selectedShown.map((r) => r.id);
    const tag = tagText.trim();
    if (!ids.length || !tag) return;
    startTransition(async () => {
      const result = await tagPosts(ids, tag, op);
      if (!result.ok) {
        showToast(result.error, true);
        return;
      }
      setRows((list) =>
        list.map((r) => {
          const tags = result.value[r.id];
          if (tags) return { ...r, tags };
          // A video's tag shows on every post of that video.
          const sibling = r.productionId
            ? list.find((o) => o.productionId === r.productionId && result.value[o.id])
            : undefined;
          return sibling ? { ...r, tags: result.value[sibling.id] ?? r.tags } : r;
        }),
      );
      setTagText("");
      const n = ids.length;
      showToast(
        op === "add"
          ? `Tagged ${n === 1 ? "1 post" : `${n} posts`} “${tag}”.`
          : `Removed “${tag}” from ${n === 1 ? "1 post" : `${n} posts`}.`,
      );
    });
  };

  const stats = [
    { value: shown.length, label: shown.length === 1 ? "post" : "posts" },
    ...(filtered ? [{ value: rows.length, label: "in all" }] : []),
  ];

  const allChecked = shown.length > 0 && selectedShown.length === shown.length;

  return (
    <div className={styles.page}>
      <PageHeader title="Posts" stats={stats} />
      <div className={styles.toolbar} role="search" aria-label="Filter posts">
        <label className={styles.search}>
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder="Search title, idea, hook, caption"
            aria-label="Search posts"
            value={query.filters.q}
            onChange={(e) => {
              setFilter("q", e.target.value);
            }}
          />
        </label>
        {SELECTS.map((s) => (
          <Select
            key={s.key}
            label={s.label}
            value={query.filters[s.key]}
            onChange={(e) => {
              setFilter(s.key, e.target.value);
            }}
          >
            <option value="">{s.all}</option>
            {options[s.key].map((o) => (
              <option key={o.value} value={o.value}>
                {s.key === "genre" ? genreLabel(o.label) : o.label}
              </option>
            ))}
          </Select>
        ))}
        <Select
          label="Status"
          value={query.filters.status}
          onChange={(e) => {
            setFilter("status", e.target.value);
          }}
        >
          <option value="">All</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select
          label="Stats at"
          value={query.at}
          onChange={(e) => {
            setQuery((q) => ({ ...q, at: e.target.value as StatAt }));
          }}
        >
          {STAT_AT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {filtered || query.sort !== DEFAULT_QUERY.sort ? (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery((q) => ({ ...DEFAULT_QUERY, at: q.at, filters: emptyFilters() }));
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {selectedShown.length > 0 ? (
        <div className={styles.bulk} role="region" aria-label="Selected posts">
          <span>
            <b>{selectedShown.length}</b> selected
          </span>
          <input
            className={styles.tagInput}
            list="post-tags"
            placeholder="Tag, e.g. Trip"
            aria-label="Tag to add or remove"
            value={tagText}
            maxLength={40}
            onChange={(e) => {
              setTagText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyTag("add");
            }}
          />
          <datalist id="post-tags">
            {allTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <Button
            variant="primary"
            disabled={pending || !tagText.trim()}
            onClick={() => {
              applyTag("add");
            }}
          >
            Add tag
          </Button>
          <Button
            disabled={pending || !tagText.trim()}
            onClick={() => {
              applyTag("remove");
            }}
          >
            Remove tag
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSelected(new Set());
            }}
          >
            Clear selection
          </Button>
        </div>
      ) : null}

      <div className={styles.scroll}>
        {rows.length === 0 ? (
          <div className={styles.empty}>
            <p>
              No posts yet. Videos you schedule from the Workflow or the Content Factory show here.
            </p>
          </div>
        ) : (
          <div className={styles.tablewrap}>
            <table className={styles.table} aria-label="Posts">
              <thead>
                <tr>
                  <th className={styles.check}>
                    <input
                      type="checkbox"
                      aria-label="Select all shown posts"
                      checked={allChecked}
                      onChange={() => {
                        setSelected(allChecked ? new Set() : new Set(shown.map((r) => r.id)));
                      }}
                    />
                  </th>
                  <SortHeader label="Video" sortKey="title" query={query} onSort={onSort} />
                  <SortHeader label="Account" sortKey="account" query={query} onSort={onSort} />
                  <SortHeader label="Posted" sortKey="date" query={query} onSort={onSort} />
                  <SortHeader label="Genre" sortKey="genre" query={query} onSort={onSort} />
                  <SortHeader label="Style" sortKey="style" query={query} onSort={onSort} />
                  <SortHeader label="Voice" sortKey="voice" query={query} onSort={onSort} />
                  <SortHeader label="Song" sortKey="music" query={query} onSort={onSort} />
                  <SortHeader label="Routine" sortKey="routine" query={query} onSort={onSort} />
                  <th>Tags</th>
                  <th>Hook</th>
                  {METRICS.map((m) => (
                    <SortHeader
                      key={m}
                      label={METRIC_LABELS[m]}
                      sortKey={m}
                      query={query}
                      onSort={onSort}
                      numeric
                    />
                  ))}
                </tr>
                <tr className={styles.summary} data-testid="posts-summary">
                  <th colSpan={COLUMNS - METRICS.length} scope="row">
                    {summary.posts === 1 ? "1 post" : `${summary.posts} posts`}
                    <span className={styles.small}>
                      {" "}
                      {summary.withStats} with stats at{" "}
                      {STAT_AT_OPTIONS.find((o) => o.value === query.at)?.label.toLowerCase()}.
                      Total, then median.
                    </span>
                  </th>
                  {METRICS.map((m) => (
                    <td key={m} className={styles.num} data-metric={m}>
                      <b>{statCount(summary.totals[m])}</b>
                      <span className={styles.small}>{statCount(summary.medians[m])}</span>
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS} className={styles.none}>
                      No posts match these filters.
                    </td>
                  </tr>
                ) : null}
                {shown.map((r) => {
                  const counts = countsAt(r, query.at);
                  const isOpen = open.has(r.id);
                  return (
                    <Fragment key={r.id}>
                      <tr className={styles.row} data-testid="post-row" data-post-id={r.id}>
                        <td className={styles.check}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.title}`}
                            checked={selected.has(r.id)}
                            onChange={() => {
                              setSelected((s) => toggle(s, r.id));
                            }}
                          />
                        </td>
                        <td>
                          <div className={styles.video}>
                            <button
                              type="button"
                              className={styles.expand}
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? "Hide" : "Show"} details of ${r.title}`}
                              onClick={() => {
                                setOpen((s) => toggle(s, r.id));
                              }}
                            >
                              {isOpen ? (
                                <ChevronDown aria-hidden="true" />
                              ) : (
                                <ChevronRight aria-hidden="true" />
                              )}
                            </button>
                            <span className={styles.thumb}>
                              {r.thumbnailUrl ? (
                                // Signed Storage URLs: plain img, like the canvas cards.
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.thumbnailUrl} alt="" />
                              ) : (
                                <Play aria-hidden="true" />
                              )}
                            </span>
                            <span className={styles.title} data-testid="post-title">
                              {r.productionId ? (
                                <Link href={`/factory/${r.productionId}`}>{r.title}</Link>
                              ) : (
                                r.title
                              )}
                            </span>
                          </div>
                        </td>
                        <td className={styles.nowrap}>@{r.handle}</td>
                        <td className={styles.nowrap}>
                          <span data-status={r.status} className={styles.status}>
                            {STATUS_LABELS[r.status]}
                          </span>
                          <span className={styles.small}>
                            {whenLabel(new Date(rowDate(r)), clock, timezone)}
                          </span>
                        </td>
                        <td>{r.genre ? genreLabel(r.genre) : <Dash />}</td>
                        <td>{r.styleLabel ?? <Dash />}</td>
                        <td className={styles.clip}>
                          {r.voiceLabel ? (
                            <span title={r.voiceLabel}>{r.voiceLabel}</span>
                          ) : (
                            <Dash />
                          )}
                        </td>
                        <td className={styles.clip}>
                          {r.musicLabel ? (
                            <span title={r.musicLabel}>{r.musicLabel}</span>
                          ) : (
                            <Dash />
                          )}
                        </td>
                        <td>
                          {r.routineId ? (
                            <Link href={`/routines/${r.routineId}`}>
                              {r.routineName ?? "Routine"}
                            </Link>
                          ) : (
                            <Dash />
                          )}
                        </td>
                        <td>
                          <div className={styles.tags} data-testid="post-tags">
                            {r.tags.length ? (
                              r.tags.map((t) => <Tag key={t} label={t} />)
                            ) : (
                              <Dash />
                            )}
                          </div>
                        </td>
                        <td className={styles.hook}>{r.hook ?? <Dash />}</td>
                        {METRICS.map((m) => (
                          <td key={m} className={styles.num} data-metric={m}>
                            {counts ? statCount(counts[m]) : <Dash />}
                          </td>
                        ))}
                      </tr>
                      {isOpen ? (
                        <tr className={styles.detailRow}>
                          <td />
                          <td colSpan={COLUMNS - 1}>
                            <dl className={styles.detail}>
                              <dt>Idea</dt>
                              <dd>{r.idea || <Dash />}</dd>
                              <dt>Hook</dt>
                              <dd>{r.hook ?? <Dash />}</dd>
                              <dt>Script</dt>
                              <dd>
                                {r.script.length ? (
                                  <ol className={styles.script}>
                                    {r.script.map((line, i) => (
                                      <li key={i}>{line}</li>
                                    ))}
                                  </ol>
                                ) : (
                                  <Dash />
                                )}
                              </dd>
                              <dt>Caption</dt>
                              <dd className={styles.caption}>{r.caption || <Dash />}</dd>
                              {r.permalink ? (
                                <>
                                  <dt>Post</dt>
                                  <dd>
                                    <a href={r.permalink} target="_blank" rel="noreferrer">
                                      Open on Instagram
                                      <ExternalLink aria-hidden="true" />
                                    </a>
                                  </dd>
                                </>
                              ) : null}
                            </dl>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Toast
        message={toast?.message ?? null}
        id={toast?.id}
        tone={toast?.error ? "error" : undefined}
        onDone={() => {
          setToast(null);
        }}
      />
    </div>
  );
}
