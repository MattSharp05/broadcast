import Link from "next/link";
import { StatusDot } from "@/components/StatusDot";
import type { VideoListItem } from "@/lib/db/factory-page";
import { usd } from "@/lib/domain/factory/budget";
import { stylePack } from "@/lib/domain/factory/styles";
import { NewVideoButton } from "./NewVideoButton";
import { STATUS_TONE, STATUS_WORD } from "./status";
import styles from "./factory.module.css";

/** Every video, newest first: one table for all kinds (with or without an avatar). */
export function FactoryList({ videos }: { videos: VideoListItem[] }) {
  if (videos.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <h2>No videos yet</h2>
          <p className={styles.help}>
            Start with an idea. You pick the style, an avatar or none, the voice and the music; a
            Claude session makes the video and you approve each step (or put it on autopilot).
          </p>
          <NewVideoButton />
        </div>
      </div>
    );
  }
  return (
    <div className={styles.page}>
      <div className={styles.tablewrap}>
        <table className={styles.table} aria-label="Videos">
          <thead>
            <tr>
              <th>Video</th>
              <th>Account</th>
              <th>Style</th>
              <th>Avatar</th>
              <th>Status</th>
              <th>Step</th>
              <th className={styles.num}>Spent</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((v) => (
              <tr key={v.id} data-video={v.id}>
                <td>
                  <Link href={`/factory/${v.id}`} className={styles.titleLink}>
                    {v.title}
                  </Link>
                </td>
                <td>
                  {v.handle ? `@${v.handle}` : <span className={styles.muted}>Not chosen</span>}
                </td>
                <td>
                  {stylePack(v.style)?.label ?? <span className={styles.muted}>Not chosen</span>}
                </td>
                <td>{v.avatar ?? <span className={styles.muted}>None</span>}</td>
                <td>
                  <StatusDot tone={STATUS_TONE[v.status] ?? "neutral"}>
                    {STATUS_WORD[v.status] ?? v.status}
                  </StatusDot>
                </td>
                <td>{v.stepLabel ?? <span className={styles.muted}>Not started</span>}</td>
                <td className={styles.num}>{usd(v.spendUsd)}</td>
                <td className={styles.muted}>{v.updated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
