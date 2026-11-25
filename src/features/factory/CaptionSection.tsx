"use client";

import { useState } from "react";
import type { VideoPatch } from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import { TextArea } from "@/components/TextArea";
import type { ProductionPage } from "@/lib/db/factory-page";
import { CAPTION_MAX } from "@/lib/domain/factory/captions";
import styles from "./factory.module.css";

/**
 * Section 8 on the Make tab: the caption now lives on the Ready to post tab (BC-39), with the
 * hashtags, the cover and the checks. This points there instead of duplicating the editor.
 */
export function CaptionSection({
  video,
  hasVersions,
  onOpenReady,
  save,
  pending,
}: {
  video: ProductionPage;
  hasVersions: boolean;
  onOpenReady: () => void;
  save: (patch: VideoPatch) => void;
  pending: boolean;
}) {
  if (!hasVersions && video.captionOptions.length > 0) {
    return <LegacyCaptionEditor video={video} save={save} pending={pending} />;
  }
  return (
    <section id="caption" className={styles.section} aria-labelledby="caption-h">
      <div className={styles.sectionHead}>
        <h2 id="caption-h">8. Caption</h2>
        <span className={styles.free}>Free</span>
      </div>
      <p className={styles.help}>
        {video.captionOptions.length
          ? "The caption drafts, with their credit lines, are on the Ready to post tab with the hashtags, the cover and the checks."
          : "Caption drafts appear after the render, with the credit lines the video needs, on the Ready to post tab."}
      </p>
      <div className={styles.row}>
        <a
          href="?tab=ready"
          onClick={(e) => {
            e.preventDefault();
            onOpenReady();
          }}
        >
          Open Ready to post
        </a>
      </div>
    </section>
  );
}

/** Section 8 for a video without versions (made before the studio): the caption edited here. */
function LegacyCaptionEditor({
  video,
  save,
  pending,
}: {
  video: ProductionPage;
  save: (patch: VideoPatch) => void;
  pending: boolean;
}) {
  const [text, setText] = useState(video.caption ?? "");
  const locked = video.status === "scheduled" || pending;
  return (
    <section id="caption" className={styles.section} aria-labelledby="caption-h">
      <div className={styles.sectionHead}>
        <h2 id="caption-h">8. Caption</h2>
        <span className={styles.free}>Free</span>
      </div>
      {video.captionOptions.length === 0 ? (
        <p className={styles.help}>
          Caption options appear after the render, with the credit lines the video needs (CC BY
          music, AI voice, AI avatar, imagery).
        </p>
      ) : (
        <>
          <div
            className={styles.captions}
            role="radiogroup"
            aria-label="Caption options"
            data-testid="caption-options"
          >
            {video.captionOptions.map((c, i) => (
              <label key={i} className={styles.item} data-selected={text === c}>
                <input
                  type="radio"
                  name="caption-option"
                  checked={text === c}
                  disabled={locked}
                  onChange={() => {
                    setText(c);
                  }}
                />
                <span className={`${styles.itemBody} ${styles.captionOption}`}>{c}</span>
              </label>
            ))}
          </div>
          <label className={styles.field}>
            Caption
            <TextArea
              className={styles.textarea}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
              maxLength={CAPTION_MAX}
              disabled={locked}
              rows={6}
            />
          </label>
          <div className={styles.row}>
            <Button
              disabled={locked || text === (video.caption ?? "")}
              onClick={() => {
                save({ caption: text });
              }}
            >
              Save caption
            </Button>
            <span className={styles.meta}>
              {text.length} / {CAPTION_MAX}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
