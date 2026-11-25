"use client";

import { useState } from "react";
import { LIST_FILTERS, type ListFilter } from "@/lib/domain/factory/list";
import type { VideoCard as Card } from "@/lib/factory/list";
import { NewVideoButton } from "./NewVideoButton";
import { PromptBox } from "./studio/PromptBox";
import { VideoCard } from "./studio/VideoCard";
import factory from "./factory.module.css";
import styles from "./studio/studio.module.css";

/**
 * The studio list (BC-42): a prompt box to start a video, then every video as a card (newest
 * version, state, last activity), filtered by what needs Matthew and sorted by last activity.
 */
export function FactoryList({
  videos,
  accounts,
}: {
  videos: Card[];
  accounts: { id: string; handle: string }[];
}) {
  const [filter, setFilter] = useState<ListFilter>("all");
  const shown = videos.filter((v) => v.filters.includes(filter));
  return (
    <div className={factory.page}>
      <PromptBox accounts={accounts} />
      {videos.length === 0 ? (
        <div className={factory.empty}>
          <h2>No videos yet</h2>
          <p className={factory.help}>
            Write what the video is about above and Start, or set everything up yourself first. You
            pick the style, an avatar or none, the voice and the music; a Claude session makes the
            video and you approve each step (or put it on autopilot).
          </p>
          <NewVideoButton />
        </div>
      ) : (
        <>
          <div className={styles.filters} role="group" aria-label="Show">
            {LIST_FILTERS.map((f) => {
              const count = videos.filter((v) => v.filters.includes(f.key)).length;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => {
                    setFilter(f.key);
                  }}
                >
                  {f.label}
                  <span className={styles.tabCount}>{count}</span>
                </button>
              );
            })}
          </div>
          {shown.length ? (
            <ul className={styles.grid} aria-label="Videos">
              {shown.map((v) => (
                <VideoCard key={v.id} card={v} />
              ))}
            </ul>
          ) : (
            <p className={factory.help} data-testid="no-match">
              Nothing here right now.
            </p>
          )}
        </>
      )}
    </div>
  );
}
