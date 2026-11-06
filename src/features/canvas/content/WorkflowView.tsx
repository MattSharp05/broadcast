"use client";

import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { TagFilter } from "@/components/TagFilter";
import { Canvas, type CanvasHandle } from "@/features/canvas/engine";
import type { CanvasColumn, CanvasStats } from "@/lib/domain/canvas";
import { nowLabel, shortCountdown } from "@/lib/domain/format";
import { ALL_TAGS, filterByTag, tagsOf } from "@/lib/domain/tags";
import { AccountHeader, PostedPostCard, UpcomingPostCard, place, type CanvasClock } from "./cards";
import styles from "./content.module.css";
import { LEFT, layoutCanvas, nowAnchor, type CanvasLayout } from "./layout";
import { workflowStats } from "./stats";
import { useMinuteClock } from "./useMinuteClock";

export interface WorkflowViewProps {
  columns: CanvasColumn[];
  stats: CanvasStats;
  /** The workspace's now when the page was rendered (ISO). */
  now: string;
  /** True when the Sandbox clock is frozen (`?now=`): labels don't tick. */
  frozen: boolean;
  timezone: string;
}

const NARROW_QUERY = "(max-width: 699px)";

function subscribeNarrow(onChange: () => void) {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => {
    mq.removeEventListener("change", onChange);
  };
}

/** The cards, arrows and headers. Re-renders only when the layout or the minute changes. */
const CanvasContent = memo(function CanvasContent({
  layout,
  clock,
  empty,
}: {
  layout: CanvasLayout;
  clock: CanvasClock;
  empty: "none" | "filtered" | null;
}) {
  const bandWidth = layout.band.x1 - layout.band.x0;
  return (
    <>
      <div className={styles.band} style={place(layout.band)} aria-hidden="true" />
      <div
        className={styles.nowLine}
        style={{ left: layout.nowLeft, width: layout.nowRight - layout.nowLeft }}
        data-now-line=""
        aria-hidden="true"
      />
      <svg className={styles.wires} aria-hidden="true" data-arrows={layout.arrows.length}>
        {layout.arrows.map((a, i) => (
          <path key={i} d={a.d} data-ghost={a.ghost ? "" : undefined} />
        ))}
      </svg>

      <section
        className={styles.lane}
        style={{ left: layout.upcomingLane.x, top: layout.upcomingLane.y }}
      >
        <h2>
          <ArrowUp aria-hidden="true" />
          Upcoming
        </h2>
        <p>The next post sits nearest the line. Arrows show the order they go out.</p>
      </section>
      <section
        className={styles.lane}
        style={{ left: layout.postedLane.x, top: layout.postedLane.y }}
      >
        <h2>
          <ArrowDown aria-hidden="true" />
          Posted
        </h2>
        <p>Newest first. Stats refresh 1 h, 6 h, 24 h, 48 h and 7 days after posting.</p>
      </section>
      {empty ? (
        <section
          className={styles.lane}
          style={{ left: 20, top: -20, width: Math.min(260, bandWidth) }}
        >
          <h2>{empty === "filtered" ? "No accounts with this tag" : "No accounts yet"}</h2>
          {empty === "none" ? <p>Add one on the Accounts tab.</p> : null}
        </section>
      ) : null}

      {layout.columns.map((col) => {
        const { column } = col;
        return (
          <div key={column.id} data-column={column.handle}>
            <AccountHeader column={column} rect={col.header} />
            <span className={styles.chip} style={{ left: col.chip.x }} data-chip="">
              {column.next.kind === "next" && column.next.at <= clock.now ? (
                "Due now"
              ) : column.next.kind === "next" ? (
                <>
                  Next in <b>{shortCountdown(column.next.at, clock.now)}</b>
                </>
              ) : column.next.kind === "paused" ? (
                "Paused"
              ) : (
                "Nothing queued"
              )}
            </span>
            {col.upcoming.map(({ item, rect }) => (
              <UpcomingPostCard
                key={item.id}
                card={item}
                rect={rect}
                colour={column.avatar}
                clock={clock}
              />
            ))}
            {col.more ? (
              <div className={styles.more} style={place(col.more)} data-more="">
                {column.moreInBacklog} more in backlog
              </div>
            ) : null}
            {col.posted.map(({ item, rect }) => (
              <PostedPostCard
                key={item.id}
                card={item}
                rect={rect}
                colour={column.avatar}
                clock={clock}
              />
            ))}
          </div>
        );
      })}
      <span className={styles.nowTag} style={{ left: LEFT }} data-now-tag="">
        Now: {nowLabel(clock.now, clock.timezone)}
      </span>
    </>
  );
});

/** The Workflow tab: top bar (stats, tag filter, Add content) over the canvas. */
export function WorkflowView({ columns, stats, now: nowIso, frozen, timezone }: WorkflowViewProps) {
  const router = useRouter();
  const initialNow = useMemo(() => new Date(nowIso), [nowIso]);
  const now = useMinuteClock(initialNow, frozen);
  const clock = useMemo(() => ({ now, timezone }), [now, timezone]);

  const [tag, setTag] = useState(ALL_TAGS);
  const tags = useMemo(() => tagsOf(columns), [columns]);
  const activeTag = tag === ALL_TAGS || tags.includes(tag) ? tag : ALL_TAGS;
  const shown = useMemo(() => filterByTag(columns, activeTag), [columns, activeTag]);
  const layout = useMemo(() => layoutCanvas(shown), [shown]);

  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
  const anchor = useMemo(() => nowAnchor(narrow), [narrow]);

  const canvasRef = useRef<CanvasHandle>(null);
  const filterChanged = useRef(false);
  useEffect(() => {
    if (!filterChanged.current) return;
    filterChanged.current = false;
    canvasRef.current?.fitAll();
  }, [activeTag]);

  // When a countdown runs out, fetch the canvas again (once per due time).
  const refreshed = useRef(new Set<number>());
  useEffect(() => {
    if (frozen) return;
    for (const c of columns) {
      if (c.next.kind !== "next") continue;
      const t = c.next.at.getTime();
      if (t <= now.getTime() && !refreshed.current.has(t)) {
        refreshed.current.add(t);
        router.refresh();
        return;
      }
    }
  }, [columns, now, frozen, router]);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Workflow"
        stats={workflowStats(stats, now)}
        actions={
          <>
            <TagFilter
              tags={tags}
              value={activeTag}
              onChange={(t) => {
                filterChanged.current = true;
                setTag(t);
              }}
            />
            <Button variant="primary">
              <Plus aria-hidden="true" />
              Add content
            </Button>
          </>
        }
      />
      <Canvas
        ref={canvasRef}
        className={styles.canvas}
        aria-label="Workflow canvas"
        storageKey="workflow"
        bounds={layout.bounds}
        nowAnchor={anchor}
        minimapItems={layout.minimap}
      >
        <CanvasContent
          layout={layout}
          clock={clock}
          empty={columns.length === 0 ? "none" : shown.length === 0 ? "filtered" : null}
        />
      </Canvas>
    </div>
  );
}
