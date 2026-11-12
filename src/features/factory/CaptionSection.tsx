"use client";

import { useState } from "react";
import type { VideoPatch } from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import type { ProductionPage } from "@/lib/db/factory-page";
import { CAPTION_MAX } from "@/lib/domain/factory/captions";
import styles from "./factory.module.css";

/** Section 8: generated caption options with their credit lines; pick one and edit it. */
export function CaptionSection({
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
            <textarea
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
