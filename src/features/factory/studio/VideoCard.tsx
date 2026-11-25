import Link from "next/link";
import { StatusDot } from "@/components/StatusDot";
import type { VideoCard as Card } from "@/lib/factory/list";
import { STATUS_TONE, STATUS_WORD } from "../status";
import styles from "./studio.module.css";

/** One video in the studio grid: newest version's first frame, title, state and last activity. */
export function VideoCard({ card }: { card: Card }) {
  return (
    <li className={styles.videoCard} data-video={card.id} data-filters={card.filters.join(" ")}>
      <Link href={`/factory/${card.id}`} className={styles.videoLink}>
        <span className={styles.thumb}>
          {card.thumbUrl ? (
            <video
              src={`${card.thumbUrl}#t=0.5`}
              muted
              playsInline
              preload="metadata"
              aria-hidden="true"
              tabIndex={-1}
            />
          ) : (
            <span className={styles.noThumb}>No version yet</span>
          )}
        </span>
        <span className={styles.videoBody}>
          <span className={styles.videoTitle}>{card.title}</span>
          <span className={styles.meta}>{card.handle ? `@${card.handle}` : "No account yet"}</span>
          {card.filters.includes("posted") ? (
            <StatusDot tone="good">Posted</StatusDot>
          ) : (
            <StatusDot tone={STATUS_TONE[card.status] ?? "neutral"}>
              {STATUS_WORD[card.status] ?? card.status}
            </StatusDot>
          )}
          <span className={styles.videoLine} data-testid="video-line">
            {card.line}
          </span>
          {card.lastIntent ? (
            <span className={styles.lastIntent}>
              {card.lastIntent} <span className={styles.meta}>{card.lastAgo}</span>
            </span>
          ) : (
            <span className={styles.meta}>Updated {card.lastAgo}</span>
          )}
        </span>
      </Link>
    </li>
  );
}
