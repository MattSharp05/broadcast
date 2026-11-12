"use client";

import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import type { PerformanceData } from "@/lib/domain/performance";
import { Popover } from "@/components/Popover";
import { TagFilter } from "@/components/TagFilter";
import { Toast } from "@/components/Toast";
import { Canvas, type CanvasHandle } from "@/features/canvas/engine";
import { AddContent, type AddContentPreset } from "@/features/content/AddContent";
import type { ActionResult, AddContentInput, AddedContent } from "@/features/content/types";
import { DetailDrawer } from "@/features/drawers/DetailDrawer";
import type { MovePostInput, OnQueueChanged, QueueActions } from "@/features/drawers/edit-types";
import { MoveChoicesProvider, moveChoices } from "@/features/drawers/post/move";
import { mediaRules } from "@/lib/domain/move";
import { Preview } from "@/features/drawers/previews";
import type { DetailTarget } from "@/features/drawers/types";
import type { WorkflowDetails } from "@/lib/db/canvas";
import type { CanvasColumn, CanvasStats } from "@/lib/domain/canvas";
import type { ContentAccount } from "@/lib/domain/content";
import { nowLabel, shortCountdown } from "@/lib/domain/format";
import { ALL_TAGS, filterByTag, tagsOf } from "@/lib/domain/tags";
import { AccountHeader, PostedPostCard, UpcomingPostCard, place, type CanvasClock } from "./cards";
import styles from "./content.module.css";
import { DropTargets } from "./drag/DropTargets";
import type { DropTarget } from "./drag/targets";
import { useCardDrag } from "./drag/useCardDrag";
import { DETAIL_SELECTOR, useDetailInteractions } from "./interactions";
import { LEFT, layoutCanvas, nowAnchor, type CanvasLayout } from "./layout";
import { PerformanceLine } from "./PerformanceLine";
import { firstFailedCard, workflowStats } from "./stats";
import { useMinuteClock } from "./useMinuteClock";

export interface WorkflowViewProps {
  columns: CanvasColumn[];
  stats: CanvasStats;
  /** The workspace's now when the page was rendered (ISO). */
  now: string;
  /** True when the Sandbox clock is frozen (`?now=`): labels don't tick. */
  frozen: boolean;
  timezone: string;
  /** Preview and drawer data (BC-15). */
  details: WorkflowDetails;
  /** The Add content dialog's accounts and server action (BC-14). */
  contentAccounts: ContentAccount[];
  performance: PerformanceData;
  addContent: (input: AddContentInput) => Promise<ActionResult<AddedContent>>;
  /** Editing the queue and slots from the drawers (BC-18). */
  queueActions?: QueueActions;
}

const NARROW_QUERY = "(max-width: 699px)";
const MOVE_FAILED = "Couldn't move the post. Check your connection and try again.";
/** The move toast stays long enough to Undo. */
const UNDO_MS = 10_000;

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
export function WorkflowView({
  columns,
  stats,
  now: nowIso,
  frozen,
  timezone,
  details,
  contentAccounts,
  performance,
  addContent,
  queueActions,
}: WorkflowViewProps) {
  const router = useRouter();
  const initialNow = useMemo(() => new Date(nowIso), [nowIso]);
  const now = useMinuteClock(initialNow, frozen);
  const clock = useMemo(() => ({ now, timezone }), [now, timezone]);

  const [tag, setTag] = useState(ALL_TAGS);
  const tags = useMemo(() => tagsOf(columns), [columns]);
  const activeTag = tag === ALL_TAGS || tags.includes(tag) ? tag : ALL_TAGS;
  const shown = useMemo(() => filterByTag(columns, activeTag), [columns, activeTag]);
  const shownIds = useMemo(() => shown.map((c) => c.id), [shown]);
  const layout = useMemo(() => layoutCanvas(shown), [shown]);

  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
  const anchor = useMemo(() => nowAnchor(narrow), [narrow]);

  const canvasRef = useRef<CanvasHandle>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // What each card and header opens: `data-detail` key → target.
  const targets = useMemo(() => {
    const map = new Map<string, DetailTarget>();
    for (const column of columns) {
      const account = details.accounts[column.id];
      if (!account) continue;
      map.set(`account:${column.id}`, { kind: "account", account });
      for (const card of [...column.upcoming, ...column.posted]) {
        map.set(`post:${card.id}`, { kind: "post", card, account, detail: details.posts[card.id] });
      }
    }
    return map;
  }, [columns, details]);
  const { preview, open, close, handlers } = useDetailInteractions(
    (key) => targets.get(key) ?? null,
  );

  // Add content: the top bar button, or "Add a video for this slot" in an open slot's drawer
  // (that account; pinned to the slot unless it's where a queued video would go anyway).
  const [adding, setAdding] = useState<AddContentPreset | null>(null);
  const [toast, setToast] = useState<{
    id: number;
    message: string;
    undo?: MovePostInput;
    error?: boolean;
  } | null>(null);
  const showToast = useCallback(
    (message: string, extra?: { undo?: MovePostInput; error?: boolean }) => {
      setToast((t) => ({ id: (t?.id ?? 0) + 1, message, ...extra }));
    },
    [],
  );
  const clearToast = useCallback(() => {
    setToast(null);
  }, []);
  const fresh = useRef(new Set<string>());
  const openAddContent = useCallback(
    (accountId: string, slotAt?: Date) => {
      const next = contentAccounts.find((a) => a.id === accountId)?.nextOpenSlot;
      const pin = slotAt && next && slotAt.getTime() !== new Date(next).getTime();
      close();
      setAdding({ accountIds: [accountId], pinAt: pin ? slotAt : undefined });
    },
    [contentAccounts, close],
  );
  const onAdded = useCallback(
    (result: AddedContent) => {
      setAdding(null);
      for (const id of result.postIds) fresh.current.add(id);
      showToast(result.message);
      router.refresh();
    },
    [router, showToast],
  );
  // A drawer edit saved: the action already refreshed the page data (revalidatePath), so the
  // open drawer re-reads its target below; echo the action in a toast.
  const onQueueChanged = useCallback<OnQueueChanged>(
    (message, options) => {
      if (options?.close) close();
      showToast(message, { undo: options?.undo });
    },
    [close, showToast],
  );

  // Moving a post (BC-22): dragging a card, "Move to…" in the drawer, and the toast's Undo.
  const movePost = queueActions?.movePost;
  const undoMove = useCallback(
    (input: MovePostInput) => {
      if (!movePost) return;
      void movePost(input, true).then(
        (result) => {
          if (result.ok) showToast(result.value.message);
          else showToast(result.error, { error: true });
        },
        () => {
          showToast(MOVE_FAILED, { error: true });
        },
      );
    },
    [movePost, showToast],
  );
  const onDrop = useCallback(
    (cardId: string, target: DropTarget) => {
      if (!movePost) return;
      const el = pageRef.current?.querySelector<HTMLElement>(`[data-post="${CSS.escape(cardId)}"]`);
      el?.setAttribute("data-moving", "");
      void movePost({
        postId: cardId,
        accountId: target.accountId,
        placement:
          target.kind === "gap"
            ? { kind: "queue", after: target.after }
            : { kind: "slot", at: target.at.toISOString() },
      })
        .then(
          (result) => {
            if (result.ok) showToast(result.value.message, { undo: result.value.undo });
            else showToast(result.error, { error: true });
          },
          () => {
            showToast(MOVE_FAILED, { error: true });
          },
        )
        .finally(() => {
          el?.removeAttribute("data-moving");
        });
    },
    [movePost, showToast],
  );
  const accountsById = details.accounts;
  const accepts = useCallback(
    (targetId: string, sourceId: string) => {
      const target = accountsById[targetId];
      const source = accountsById[sourceId];
      return (
        !!target &&
        !!source &&
        target.status === "ready" &&
        target.slots.length > 0 &&
        mediaRules(target.platform) === mediaRules(source.platform)
      );
    },
    [accountsById],
  );
  const { handler: itemDrag, drag } = useCardDrag({
    layout,
    enabled: !!movePost,
    accepts,
    onDrop,
  });
  const choices = useMemo(() => moveChoices(columns, accepts), [columns, accepts]);
  // The open drawer follows the refreshed data. A post that moved off the canvas (pinned next
  // week, back of a long backlog) keeps its last data rather than closing mid-edit; Remove closes
  // the drawer itself.
  const openTarget = open ? (targets.get(open.key) ?? open.target) : null;

  // The new cards get a brief highlight once the refreshed canvas shows them.
  useEffect(() => {
    if (fresh.current.size === 0) return;
    for (const id of [...fresh.current]) {
      const el = pageRef.current?.querySelector<HTMLElement>(`[data-post="${CSS.escape(id)}"]`);
      if (!el) continue;
      el.setAttribute("data-fresh", "");
      fresh.current.delete(id);
    }
  }, [columns, activeTag]);

  // Keyboard focus on a card: the browser scrolls the (overflow: hidden) stage to show it, which
  // the transform-based canvas doesn't expect. Undo the scroll and pan to the card instead.
  useEffect(() => {
    const stage = pageRef.current?.querySelector<HTMLElement>("[data-canvas-stage]");
    if (!stage) return;
    const unscroll = () => {
      if (stage.scrollTop !== 0) stage.scrollTop = 0;
      if (stage.scrollLeft !== 0) stage.scrollLeft = 0;
    };
    let frame = 0;
    const onFocus = (e: FocusEvent) => {
      const el =
        e.target instanceof Element ? e.target.closest<HTMLElement>(DETAIL_SELECTOR) : null;
      if (!el) return;
      // Only keyboard focus pans (a click focuses a card that's already under the pointer).
      const keyboard = el.matches(":focus-visible");
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        unscroll();
        if (!keyboard) return;
        const s = stage.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom)
          return;
        const x = parseFloat(el.style.left) + parseFloat(el.style.width) / 2;
        const y = parseFloat(el.style.top) + parseFloat(el.style.height) / 2;
        if (Number.isFinite(x) && Number.isFinite(y)) canvasRef.current?.centerOn({ x, y });
      });
    };
    stage.addEventListener("scroll", unscroll);
    stage.addEventListener("focusin", onFocus);
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener("scroll", unscroll);
      stage.removeEventListener("focusin", onFocus);
    };
  }, []);
  const filterChanged = useRef(false);
  useEffect(() => {
    if (!filterChanged.current) return;
    filterChanged.current = false;
    canvasRef.current?.fitAll();
  }, [activeTag]);

  // "N failed" in the top bar (BC-20): pan to the newest failed card and flash it. A tag filter
  // that hides every failed card is cleared first.
  const failedPan = useRef(false);
  const panToFailed = useCallback(() => {
    const target = firstFailedCard(layout);
    if (!target) {
      if (activeTag !== ALL_TAGS) {
        failedPan.current = true;
        setTag(ALL_TAGS);
      }
      return;
    }
    canvasRef.current?.centerOn({ x: target.x, y: target.y });
    const el = pageRef.current?.querySelector<HTMLElement>(
      `[data-post="${CSS.escape(target.id)}"]`,
    );
    if (el) {
      // Replay the highlight: remove it, force a style flush, add it again.
      el.removeAttribute("data-fresh");
      el.getBoundingClientRect();
      el.setAttribute("data-fresh", "");
    }
  }, [layout, activeTag]);
  useEffect(() => {
    if (!failedPan.current) return;
    failedPan.current = false;
    panToFailed();
  }, [panToFailed]);

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
    <div className={styles.page} ref={pageRef}>
      <PageHeader
        title="Workflow"
        stats={workflowStats(stats, now, panToFailed)}
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
            <Button
              variant="primary"
              onClick={() => {
                setAdding({ accountIds: [] });
              }}
              data-testid="add-content-button"
            >
              <Plus aria-hidden="true" />
              Add content
            </Button>
          </>
        }
      />
      <PerformanceLine data={performance} accountIds={shownIds} now={now} />
      <Canvas
        ref={canvasRef}
        className={styles.canvas}
        aria-label="Workflow canvas"
        storageKey="workflow"
        bounds={layout.bounds}
        nowAnchor={anchor}
        minimapItems={layout.minimap}
        itemDrag={itemDrag}
      >
        <div className={styles.content} {...handlers}>
          <CanvasContent
            layout={layout}
            clock={clock}
            empty={columns.length === 0 ? "none" : shown.length === 0 ? "filtered" : null}
          />
          <DropTargets drag={drag} />
        </div>
      </Canvas>
      {preview && !openTarget && !drag ? (
        <Popover anchor={preview.anchor} data-testid="canvas-preview">
          <Preview target={preview.target} clock={clock} />
        </Popover>
      ) : null}
      <MoveChoicesProvider value={choices}>
        <DetailDrawer
          target={openTarget}
          clock={clock}
          onClose={close}
          returnFocus={open?.returnFocus}
          onAddContent={openAddContent}
          actions={queueActions}
          onChanged={onQueueChanged}
        />
      </MoveChoicesProvider>
      <AddContent
        open={adding !== null}
        onClose={() => {
          setAdding(null);
        }}
        accounts={contentAccounts}
        preset={adding}
        now={now}
        timezone={timezone}
        addContent={addContent}
        onAdded={onAdded}
      />
      <Toast
        message={toast?.message ?? null}
        id={toast?.id}
        onDone={clearToast}
        tone={toast?.error ? "error" : undefined}
        duration={toast?.undo ? UNDO_MS : undefined}
        action={
          toast?.undo
            ? {
                label: "Undo",
                onClick: () => {
                  if (toast.undo) undoMove(toast.undo);
                },
              }
            : undefined
        }
      />
    </div>
  );
}
