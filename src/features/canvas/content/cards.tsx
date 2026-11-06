import {
  Clock,
  ExternalLink,
  Eye,
  Heart,
  Loader,
  MessageSquare,
  Pin,
  Play,
  TriangleExclamationPoint,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { platformName } from "@/components/PlatformGlyph";
import type { Rect } from "@/features/canvas/engine";
import type { CanvasColumn, PostedCard, UpcomingCard } from "@/lib/domain/canvas";
import { compactCount, duration, statCount, whenLabel } from "@/lib/domain/format";
import styles from "./content.module.css";

/** Absolute position and size of a world rectangle. */
export function place(r: Rect): CSSProperties {
  return { left: r.x0, top: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0 };
}

export interface CanvasClock {
  now: Date;
  timezone: string;
}

/** 9:16 thumbnail: the real one when uploaded, else the placeholder (colour strip, play mark). */
export function Thumb({
  url,
  durationS,
  colour,
  className,
}: {
  url: string | null;
  durationS: number | null;
  colour: number;
  className?: string;
}) {
  return (
    <div
      className={[styles.thumb, className].filter(Boolean).join(" ")}
      style={{ "--tint": `var(--avatar-${colour})` } as CSSProperties}
    >
      {url ? (
        // A signed Storage URL: next/image would need every Supabase host configured.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" draggable={false} />
      ) : (
        <span className={styles.play}>
          <Play aria-hidden="true" />
        </span>
      )}
      {durationS ? <span className={styles.duration}>{duration(durationS)}</span> : null}
    </div>
  );
}

export function AccountHeader({ column, rect }: { column: CanvasColumn; rect: Rect }) {
  const platform = platformName(column.platform);
  const attention = column.status !== "ready";
  return (
    <div
      className={styles.header}
      style={place(rect)}
      role="group"
      aria-label={`@${column.handle}. Press Enter for account details.`}
      tabIndex={0}
      data-detail={`account:${column.id}`}
      data-account={column.handle}
      data-attention={attention ? "" : undefined}
    >
      <div className={styles.row}>
        <Avatar
          handle={column.handle}
          platform={column.platform}
          colour={column.avatar}
          size={42}
          className={styles.headerAvatar}
        />
        <div className={styles.names}>
          <div className={styles.handle}>@{column.handle}</div>
          <div className={styles.small} title={`${column.brand}, ${platform}`}>
            {column.brand}, {platform}
          </div>
        </div>
        <a
          className={styles.profile}
          href={column.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open @${column.handle} on ${platform}`}
          title={`Open on ${platform}`}
          data-canvas-nopan=""
          onClick={(e) => {
            // The link only opens the profile; nothing on the card reacts to it.
            e.stopPropagation();
          }}
        >
          <ExternalLink aria-hidden="true" />
        </a>
      </div>
      {attention ? (
        <div className={styles.facts}>
          <TriangleExclamationPoint aria-hidden="true" />
          {column.status === "needs_attention" ? "Needs reconnecting" : "Not connected"}
        </div>
      ) : (
        <div className={styles.facts}>
          <span>
            <b>{compactCount(column.followers ?? 0)}</b> followers
          </span>
          <span>
            <b>{column.backlog}</b> in backlog
          </span>
        </div>
      )}
    </div>
  );
}

function Status({ tone, icon, children }: { tone?: string; icon: ReactNode; children: string }) {
  return (
    <span className={styles.status} data-tone={tone}>
      {icon}
      {children}
    </span>
  );
}

function CardShell({
  kind,
  id,
  rect,
  thumb,
  when,
  status,
  title,
  footer,
  label,
}: {
  label: string;
  kind: string;
  id: string;
  rect: Rect;
  thumb: ReactNode;
  when: string;
  status: ReactNode;
  title: string;
  footer: ReactNode;
}) {
  return (
    <article
      className={styles.card}
      style={place(rect)}
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={label}
      data-detail={`post:${id}`}
      data-kind={kind}
      data-post={id}
    >
      {thumb}
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.when}>{when}</span>
          {status}
        </div>
        <span className={styles.title}>{title}</span>
        {footer}
      </div>
    </article>
  );
}

export function UpcomingPostCard({
  card,
  rect,
  colour,
  clock,
}: {
  card: UpcomingCard;
  rect: Rect;
  colour: number;
  clock: CanvasClock;
}) {
  if (card.kind === "open") {
    return (
      <div
        className={styles.card}
        style={place(rect)}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-label={`Open slot, ${whenLabel(card.at, clock.now, clock.timezone)}`}
        data-detail={`post:${card.id}`}
        data-kind="open"
        data-post={card.id}
      >
        <span className={styles.when}>{whenLabel(card.at, clock.now, clock.timezone)}</span>
        <span className={styles.small}>Open slot. Fills from the backlog.</span>
      </div>
    );
  }
  const when = card.at ? whenLabel(card.at, clock.now, clock.timezone) : "No slot yet";
  let status: ReactNode;
  let foot: string;
  let word: string;
  switch (card.kind) {
    case "pinned":
      status = (
        <Status tone="accent" icon={<Pin aria-hidden="true" />}>
          Pinned
        </Status>
      );
      foot = "Fixed time";
      word = "Pinned";
      break;
    case "paused":
      status = (
        <Status tone="warn" icon={<TriangleExclamationPoint aria-hidden="true" />}>
          Paused
        </Status>
      );
      foot = "Waiting for reconnect";
      word = "Paused";
      break;
    case "publishing":
      status = (
        <Status tone="accent" icon={<Loader aria-hidden="true" />}>
          Publishing
        </Status>
      );
      foot = "Instagram is processing it";
      word = "Publishing";
      break;
    default:
      status = (
        <Status tone="accent" icon={<Clock aria-hidden="true" />}>
          Scheduled
        </Status>
      );
      foot = card.at ? "Queue slot" : "Add a slot to schedule it";
      word = "Scheduled";
  }
  return (
    <CardShell
      label={`${card.title}, ${word}, ${when}`}
      kind={card.kind}
      id={card.id}
      rect={rect}
      thumb={<Thumb url={card.thumbnailUrl} durationS={card.durationS} colour={colour} />}
      when={when}
      status={status}
      title={card.title}
      footer={<span className={styles.foot}>{foot}</span>}
    />
  );
}

export function PostedPostCard({
  card,
  rect,
  colour,
  clock,
}: {
  card: PostedCard;
  rect: Rect;
  colour: number;
  clock: CanvasClock;
}) {
  const thumb = <Thumb url={card.thumbnailUrl} durationS={card.durationS} colour={colour} />;
  const when = whenLabel(card.at, clock.now, clock.timezone);
  if (card.kind === "failed") {
    return (
      <CardShell
        label={`${card.title}, failed, ${when}`}
        kind="failed"
        id={card.id}
        rect={rect}
        thumb={thumb}
        when={when}
        status={
          <Status tone="bad" icon={<TriangleExclamationPoint aria-hidden="true" />}>
            Failed
          </Status>
        }
        title={card.title}
        footer={<span className={styles.foot}>{card.reason}</span>}
      />
    );
  }
  return (
    <CardShell
      label={`${card.title}, posted ${when}`}
      kind="posted"
      id={card.id}
      rect={rect}
      thumb={thumb}
      when={when}
      status={null}
      title={card.title}
      footer={
        <span className={styles.metrics}>
          <span title="Views">
            <Eye aria-hidden="true" />
            {statCount(card.views)}
          </span>
          <span title="Likes">
            <Heart aria-hidden="true" />
            {statCount(card.likes)}
          </span>
          <span title="Comments">
            <MessageSquare aria-hidden="true" />
            {statCount(card.comments)}
          </span>
        </span>
      }
    />
  );
}
