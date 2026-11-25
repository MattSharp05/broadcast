"use client";

import { CircleCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { markReady, savePack } from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import { TextArea } from "@/components/TextArea";
import { CAPTION_MAX } from "@/lib/domain/factory/captions";
import { deliveryChecks, deliveryReady, postedCaption } from "@/lib/domain/factory/delivery";
import { ChecksPanel } from "./ChecksPanel";
import { CoverPicker } from "./CoverPicker";
import { HashtagField } from "./HashtagField";
import type { StudioTabProps } from "./tabs";
import styles from "./studio.module.css";

/**
 * Ready to post (BC-39): prepare one version for Instagram: a cover from a frame, the caption with
 * its credit lines, hashtags, and the checks. Mark ready records the pack; scheduling it stays a
 * separate, deliberate click.
 */
export function ReadyTab({ video, studio, run, notify, pending }: StudioTabProps) {
  const versions = studio.versions.filter((v) => !v.pruned);
  const [versionId, setVersionId] = useState(versions[0]?.id ?? null);
  const version = versions.find((v) => v.id === versionId) ?? versions[0];
  if (!version) {
    return (
      <div className={styles.empty} data-testid="no-versions">
        <h2>Nothing to post yet</h2>
        <p className={styles.help}>A version appears here once the render step has run.</p>
      </div>
    );
  }
  return (
    <div className={styles.ready}>
      <label className={styles.field}>
        Version to post
        <select
          className={styles.select}
          value={version.id}
          onChange={(e) => {
            setVersionId(e.target.value);
          }}
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.number}, {v.when}
              {studio.packs.find((k) => k.versionId === v.id)?.readyAt ? " (ready)" : ""}
            </option>
          ))}
        </select>
      </label>
      <ReadyPanels
        key={version.id}
        video={video}
        studio={studio}
        versionId={version.id}
        run={run}
        notify={notify}
        pending={pending}
      />
    </div>
  );
}

function ReadyPanels({
  video,
  studio,
  versionId,
  run,
  notify,
  pending,
}: Omit<StudioTabProps, "options"> & { versionId: string }) {
  const router = useRouter();
  const version = studio.versions.find((v) => v.id === versionId);
  const pack = studio.packs.find((k) => k.versionId === versionId) ?? null;
  const savedCaption = pack?.caption ?? video.caption ?? "";
  const savedTags = pack?.hashtags ?? [];
  const [caption, setCaption] = useState(savedCaption);
  const [hashtags, setHashtags] = useState<string[]>(savedTags);
  if (!version) return null;
  const dirty = caption !== savedCaption || hashtags.join(" ") !== savedTags.join(" ");
  const locked = video.status === "scheduled" || pending;

  const checks = deliveryChecks({
    width: version.width ?? 0,
    height: version.height ?? 0,
    durationS: version.durationS ?? 0,
    bytes: version.bytes ?? 0,
    loudnessLufs: version.loudnessLufs,
    truePeakDb: version.truePeakDb,
    caption,
    credits: studio.credits,
    hashtags,
    avatar: studio.aiFlag,
    aiFlag: studio.aiFlag,
    coverChosen: Boolean(pack?.coverPath),
  });
  const missing = studio.credits.filter((c) => !caption.includes(c));
  const posted = postedCaption(caption, hashtags);

  return (
    <div className={styles.readyGrid}>
      <CoverPicker videoId={video.id} version={version} pack={pack} notify={notify} />

      <section className={styles.panel} aria-labelledby="caption-h" id="caption">
        <div className={styles.sectionHead}>
          <h2 id="caption-h">Caption and hashtags</h2>
        </div>
        {video.captionOptions.length ? (
          <div
            className={styles.options}
            role="radiogroup"
            aria-label="Caption drafts"
            data-testid="caption-options"
          >
            {video.captionOptions.map((c, i) => (
              <label key={i} className={styles.option} data-selected={caption === c}>
                <input
                  type="radio"
                  name="caption-draft"
                  checked={caption === c}
                  disabled={locked}
                  onChange={() => {
                    setCaption(c);
                  }}
                />
                <span>{c}</span>
              </label>
            ))}
          </div>
        ) : null}
        <label className={styles.field}>
          Caption
          <TextArea
            className={styles.textarea}
            value={caption}
            rows={6}
            maxLength={CAPTION_MAX}
            disabled={locked}
            onChange={(e) => {
              setCaption(e.target.value);
            }}
          />
        </label>
        <span
          className={styles.meta}
          data-over={posted.length > CAPTION_MAX}
          data-testid="caption-count"
        >
          {posted.length} / {CAPTION_MAX} with the hashtags
        </span>
        {missing.length ? (
          <p className={styles.warn} data-testid="missing-credits">
            Missing {missing.length === 1 ? "a credit line" : "credit lines"}: {missing.join(" · ")}
          </p>
        ) : null}
        <HashtagField value={hashtags} onChange={setHashtags} disabled={locked} />
        <div className={styles.row}>
          <Button
            disabled={!dirty || locked}
            onClick={() => {
              run(
                () => savePack(video.id, version.id, { caption, hashtags }),
                () => {
                  router.refresh();
                  return "Caption and hashtags saved.";
                },
              );
            }}
          >
            Save caption and hashtags
          </Button>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="checks-h">
        <div className={styles.sectionHead}>
          <h2 id="checks-h">Checks</h2>
        </div>
        <ChecksPanel checks={checks} />
        <div className={styles.row}>
          <Button
            variant="primary"
            disabled={locked || dirty || !deliveryReady(checks)}
            onClick={() => {
              run(
                () => markReady(video.id, version.id),
                () => {
                  router.refresh();
                  return `v${version.number} is ready to post.`;
                },
              );
            }}
          >
            Mark ready
          </Button>
          {dirty ? <span className={styles.meta}>Save the caption first.</span> : null}
          {pack?.readyAt && !dirty ? (
            <span className={styles.readyNote} data-testid="ready">
              <CircleCheck aria-hidden="true" />
              Ready since {pack.readyWhen}
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
