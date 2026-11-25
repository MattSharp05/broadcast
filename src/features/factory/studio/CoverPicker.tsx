"use client";

import { ImageIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { saveCover } from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import type { PackView, VersionView } from "@/lib/db/studio-page";
import { timecode } from "@/lib/domain/factory/player";
import type { Notify } from "../ProductionView";
import { Player } from "./Player";
import styles from "./studio.module.css";

/** Covers are 1080 × 1920 JPEGs (a Reel's frame). */
const COVER_W = 1080;
const COVER_H = 1920;

/**
 * Pick the cover: scrub the player to a frame and "Use this frame". The frame is drawn at Reel
 * size and uploaded next to the video; the preview shows it as a Reel and as the profile grid
 * crops it (1:1 and 4:5, centred).
 */
export function CoverPicker({
  videoId,
  version,
  pack,
  notify,
}: {
  videoId: string;
  version: VersionView;
  pack: PackView | null;
  notify: Notify;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(pack?.coverTS ?? 0);
  const [busy, setBusy] = useState(false);
  const onTime = useCallback((t: number) => {
    setTime(t);
  }, []);

  const takeFrame = async () => {
    setBusy(true);
    try {
      const blob = await drawCover(videoRef.current);
      if (!blob) {
        notify("This frame can't be read yet. Let the video load, then try again.", "error");
        return;
      }
      const asked = await fetch(`/api/factory/${videoId}/cover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version_id: version.id }),
      });
      if (!asked.ok) throw new Error("upload refused");
      const { upload_url } = (await asked.json()) as { upload_url: string };
      const put = await fetch(upload_url, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: blob,
      });
      if (!put.ok) throw new Error("upload failed");
      const res = await saveCover(videoId, version.id, time);
      if (!res.ok) {
        notify(res.error, "error");
        return;
      }
      notify(`Cover set to the frame at ${timecode(time, version.fps)}.`);
      router.refresh();
    } catch {
      notify("That didn't work. Check your connection and try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="cover-h" data-testid="cover">
      <div className={styles.sectionHead}>
        <h2 id="cover-h">Cover</h2>
        <span className={styles.meta}>A frame from v{version.number}</span>
      </div>
      <div className={styles.coverGrid}>
        <div className={styles.coverPlayer}>
          <Player
            key={version.id}
            version={version}
            notes={[]}
            time={time}
            onTime={onTime}
            onGesture={() => undefined}
            pendingBox={null}
            videoRef={videoRef}
            notesOn={false}
          />
          <Button
            variant="primary"
            disabled={busy || !version.url}
            onClick={() => void takeFrame()}
          >
            <ImageIcon aria-hidden="true" />
            Use this frame
          </Button>
        </div>
        <div className={styles.coverPreview}>
          {pack?.coverUrl ? (
            <>
              <figure className={styles.previewReel}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pack.coverUrl} alt="The cover as a Reel" data-testid="cover-image" />
                <figcaption className={styles.meta}>
                  Reel, frame at {timecode(pack.coverTS ?? 0, version.fps)}
                </figcaption>
              </figure>
              <div className={styles.previewCrops}>
                <figure className={styles.previewSquare}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pack.coverUrl} alt="The cover in the profile grid (1:1)" />
                  <figcaption className={styles.meta}>Profile grid 1:1</figcaption>
                </figure>
                <figure className={styles.previewPortrait}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pack.coverUrl} alt="The cover in the profile grid (4:5)" />
                  <figcaption className={styles.meta}>Profile grid 4:5</figcaption>
                </figure>
              </div>
            </>
          ) : (
            <p className={styles.help} data-testid="no-cover">
              No cover yet. Pause on the frame you want people to see in the feed and the profile
              grid, then Use this frame.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** The paused frame at 1080 × 1920 as a JPEG, or null when the browser can't read it. */
async function drawCover(v: HTMLVideoElement | null): Promise<Blob | null> {
  if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = COVER_W;
    canvas.height = COVER_H;
    const g = canvas.getContext("2d");
    if (!g) return null;
    // Fill the 9:16 frame (a 9:16 video fills it exactly; anything else is centred and cropped).
    const scale = Math.max(COVER_W / v.videoWidth, COVER_H / v.videoHeight);
    const w = v.videoWidth * scale;
    const h = v.videoHeight * scale;
    g.drawImage(v, (COVER_W - w) / 2, (COVER_H - h) / 2, w, h);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.9);
    });
  } catch {
    return null;
  }
}
