"use client";

import { ExternalLink, Info, TriangleExclamationPoint, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "@/components/Button";
import { StatusDot } from "@/components/StatusDot";
import { Thumb } from "@/features/canvas/content/cards";
import type { PostedCard, UpcomingCard } from "@/lib/domain/canvas";
import {
  DAILY_POST_LIMIT,
  STAT_OFFSET_LABELS,
  connectionNote,
  type AccountDetail,
  type PostDetail,
} from "@/lib/domain/details";
import { ago, compactCount } from "@/lib/domain/format";
import { RefreshChart } from "./charts";
import type { OnQueueChanged, QueueActions } from "./edit-types";
import { PostEditor } from "./post/PostEditor";
import styles from "./drawers.module.css";
import { Numbers, Row } from "./previews";
import type { DetailClock } from "./types";

export const ADD_CONTENT_SOON = "Adding videos arrives with the Add content dialog.";

function Note({ tone, children }: { tone?: "warn" | "bad"; children: ReactNode }) {
  return (
    <div className={styles.note} data-tone={tone}>
      {tone ? <TriangleExclamationPoint aria-hidden="true" /> : <Info aria-hidden="true" />}
      <span>{children}</span>
    </div>
  );
}

export interface PostDetailsProps {
  card: UpcomingCard | PostedCard;
  account: AccountDetail;
  detail?: PostDetail;
  clock: DetailClock;
  /** "Add a video for this slot": opens Add content for the account and slot (BC-14). */
  onAddContent?: (accountId: string, slotAt: Date) => void;
  /** Editing a waiting post (BC-18); read-only without. */
  actions?: QueueActions;
  onChanged?: OnQueueChanged;
}

/** The post drawer's body for each kind of card: open slot, posted, failed, waiting. */
export function PostDetails({
  card,
  account,
  detail,
  clock,
  onAddContent,
  actions,
  onChanged,
}: PostDetailsProps) {
  const { now } = clock;

  if (card.kind === "open") {
    return (
      <>
        <Note>
          When this slot comes up, the scheduler posts the next video in @{account.handle}&apos;s
          backlog.{" "}
          {account.backlog > 0
            ? `${account.backlog} ${account.backlog === 1 ? "video is" : "videos are"} waiting.`
            : "The backlog is empty, so the slot will be skipped."}
        </Note>
        <div className={styles.actions}>
          <span title={onAddContent ? undefined : ADD_CONTENT_SOON}>
            <Button
              variant="primary"
              disabled={!onAddContent}
              onClick={() => onAddContent?.(account.id, card.at)}
            >
              <Upload aria-hidden="true" />
              Add a video for this slot
            </Button>
          </span>
        </div>
      </>
    );
  }

  const thumb = (
    <Thumb
      url={card.thumbnailUrl}
      durationS={card.durationS}
      colour={account.avatar}
      className={styles.thumb}
    />
  );

  if (card.kind === "posted") {
    const stats = detail?.stats;
    const value = (n: number | undefined) => (n === undefined ? "–" : compactCount(n));
    return (
      <>
        <div className={styles.split}>
          {thumb}
          <dl className={styles.dl}>
            <Row label="Status">
              <StatusDot tone="good">Live</StatusDot>
            </Row>
            <Row label="Posted">{ago(card.at, now)}</Row>
            <Row label="Stats refreshed">
              {detail?.refreshedAt ? ago(detail.refreshedAt, now) : "Not yet"}
            </Row>
            <Row label="Next refresh">
              {detail?.nextRefresh
                ? `${STAT_OFFSET_LABELS[detail.nextRefresh]} after posting`
                : "Complete"}
            </Row>
          </dl>
        </div>
        <section className={styles.section}>
          <h3>Performance</h3>
          <Numbers
            grid
            name="performance"
            items={[
              { label: "Views", value: value(stats?.views) },
              { label: "Reach", value: value(stats?.reach) },
              { label: "Likes", value: value(stats?.likes) },
              { label: "Comments", value: value(stats?.comments) },
              { label: "Shares", value: value(stats?.shares) },
              { label: "Saves", value: value(stats?.saves) },
            ]}
          />
        </section>
        <section className={styles.section}>
          <h3>Views at each refresh</h3>
          {detail ? <RefreshChart snapshots={detail.snapshots} /> : null}
        </section>
        <div className={styles.actions}>
          {detail?.permalink ? (
            <ButtonLink
              href={detail.permalink}
              target="_blank"
              rel="noopener noreferrer"
              data-permalink=""
            >
              <ExternalLink aria-hidden="true" />
              Open the post
            </ButtonLink>
          ) : null}
          <ButtonLink href={account.profileUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" />
            Open @{account.handle}
          </ButtonLink>
          {/* "Refresh stats" arrives with stats collection (BC-21). */}
        </div>
      </>
    );
  }

  if (card.kind === "failed") {
    return (
      <>
        <Note tone="bad">{detail?.error ?? card.reason}</Note>
        <div className={styles.split}>
          {thumb}
          <dl className={styles.dl}>
            <Row label="Status">
              <StatusDot tone="bad">Failed</StatusDot>
            </Row>
            <Row label="Tries">{detail?.attempts ?? 0}</Row>
            <Row label="Was due">{ago(card.at, now)}</Row>
          </dl>
        </div>
        {/* Replace video, Retry now and Remove arrive with failed-post actions (BC-20). */}
      </>
    );
  }

  if (actions && onChanged && card.kind !== "publishing") {
    return (
      <PostEditor
        // Fresh state once the saved post comes back (new time, kind or caption).
        key={`${card.id}:${card.kind}:${card.at?.toISOString() ?? ""}:${detail?.caption ?? ""}`}
        card={card}
        account={account}
        detail={detail}
        clock={clock}
        actions={actions}
        onChanged={onChanged}
      />
    );
  }

  const pinned = card.kind === "pinned" || detail?.timing === "pinned";
  return (
    <>
      {card.kind === "paused" ? <Note tone="warn">{connectionNote(account)}</Note> : null}
      <div className={styles.split}>
        {thumb}
        <section className={styles.section} data-section="caption">
          <h3>Caption</h3>
          <p className={styles.caption}>{detail?.caption ?? card.title}</p>
        </section>
      </div>
      <section className={styles.section} data-section="timing">
        <h3>Timing</h3>
        <p>{pinned ? "Pinned time" : "Queue slot"}</p>
        <p className={styles.help}>
          {pinned
            ? "Stays at this time even if the queue changes."
            : "Moves up automatically if an earlier video is removed."}
        </p>
      </section>
      <Note>
        @{account.handle} has used {account.postsUsed24h} of its {DAILY_POST_LIMIT} Instagram posts
        in the last 24 hours.
      </Note>
    </>
  );
}
