"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import type { NoteView, VersionView } from "@/lib/db/studio-page";
import type { NoteBox } from "@/lib/domain/factory/notes";
import { gestureNote, stepFrame, timecode, type Point } from "@/lib/domain/factory/player";
import styles from "./studio.module.css";

/** How close to a note's time the frame must be for its badge to show (seconds). */
const NEAR_S = 0.5;

export type Gesture = { kind: "moment"; tS: number } | { kind: "region"; tS: number; box: NoteBox };

interface PlayerProps {
  version: VersionView;
  notes: NoteView[];
  /** The time shown (the tab's source of truth; frame steps and the scrubber set it). */
  time: number;
  onTime: (t: number) => void;
  /** A click (moment) or drag (region) on the paused frame. */
  onGesture: (g: Gesture) => void;
  /** The box of the note being written, drawn until it's added or cancelled. */
  pendingBox: NoteBox | null;
  videoRef: RefObject<HTMLVideoElement | null>;
}

/**
 * Plays one version. Paused, the frame takes notes: a click is a moment note, a drag a region
 * note (mouse or touch). Notes near the current time show as numbered badges on the frame, and
 * every timed note as a numbered mark on the scrubber.
 */
export function Player({
  version,
  notes,
  time,
  onTime,
  onGesture,
  pendingBox,
  videoRef,
}: PlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [drag, setDrag] = useState<{ start: Point; end: Point; rect: DOMRect } | null>(null);
  const fps = version.fps;
  // The stored duration, else what the file says once loaded.
  const [loadedDuration, setLoadedDuration] = useState(0);
  const duration = version.durationS ?? loadedDuration;

  // The page's time drives the video when paused (frame steps, scrubbing, clicking a note).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || playing) return;
    if (Math.abs(v.currentTime - time) > 0.5 / fps) {
      try {
        v.currentTime = time;
      } catch {
        // Not loaded yet: the time still counts for notes.
      }
    }
  }, [time, playing, fps, videoRef]);

  // While playing, the video drives the time (frame-accurate where the browser can say).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return;
    let handle = 0;
    // Not in every browser (Firefox before 132): fall back to timeupdate.
    const frames = (v as Partial<Pick<HTMLVideoElement, "requestVideoFrameCallback">>)
      .requestVideoFrameCallback;
    if (frames) {
      const tick: VideoFrameRequestCallback = (_now, meta) => {
        onTime(meta.mediaTime);
        handle = v.requestVideoFrameCallback(tick);
      };
      handle = v.requestVideoFrameCallback(tick);
      return () => {
        v.cancelVideoFrameCallback(handle);
      };
    }
    const update = () => {
      onTime(v.currentTime);
    };
    v.addEventListener("timeupdate", update);
    return () => {
      v.removeEventListener("timeupdate", update);
    };
  }, [playing, onTime, videoRef]);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
      onTime(v.currentTime);
    } else {
      void v.play().then(
        () => {
          setPlaying(true);
        },
        () => {
          setPlaying(false);
        },
      );
    }
  };

  const step = (delta: number) => {
    videoRef.current?.pause();
    setPlaying(false);
    onTime(stepFrame(time, fps, delta, duration || null));
  };

  const point = (e: React.PointerEvent): Point => ({ x: e.clientX, y: e.clientY });

  const shown = notes.filter(
    (n) => n.kind !== "general" && n.tS !== null && Math.abs(n.tS - time) <= NEAR_S,
  );
  const dragged = drag ? gestureNote(drag.start, drag.end, drag.rect) : null;
  const dragBox = dragged?.kind === "region" ? dragged.box : null;
  const drawn = dragBox ?? pendingBox;

  return (
    <div className={styles.player}>
      <div className={styles.frameWrap}>
        <video
          ref={videoRef}
          className={styles.video}
          src={version.url ?? undefined}
          // Same-origin and Storage links allow reading frames (note crops); others just play.
          crossOrigin={sameOriginOrStorage(version.url) ? "anonymous" : undefined}
          playsInline
          preload="auto"
          onEnded={() => {
            setPlaying(false);
          }}
          onLoadedMetadata={(e) => {
            if (Number.isFinite(e.currentTarget.duration))
              setLoadedDuration(e.currentTarget.duration);
            if (time > 0) e.currentTarget.currentTime = time;
          }}
          aria-label={`Version ${version.number}`}
        />
        {!version.url ? (
          <div className={styles.noVideo}>
            This version&apos;s files were cleared to save space. Its git sha ({version.gitSha}) can
            rebuild it.
          </div>
        ) : null}
        <div
          className={styles.overlay}
          data-testid="frame"
          data-paused={!playing}
          role="application"
          aria-label="Frame: pause, then click for a moment note or drag for a region note"
          onPointerDown={(e) => {
            if (playing) {
              toggle();
              return;
            }
            if (e.button !== 0 && e.pointerType === "mouse") return;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // No live pointer with that id (some touch browsers): the drag still works.
            }
            setDrag({
              start: point(e),
              end: point(e),
              rect: e.currentTarget.getBoundingClientRect(),
            });
          }}
          onPointerMove={(e) => {
            if (drag) setDrag({ ...drag, end: point(e) });
          }}
          onPointerUp={(e) => {
            if (!drag) return;
            const g = gestureNote(drag.start, point(e), drag.rect);
            setDrag(null);
            onGesture(
              g.kind === "region"
                ? { kind: "region", tS: time, box: g.box }
                : { kind: "moment", tS: time },
            );
          }}
          onPointerCancel={() => {
            setDrag(null);
          }}
        >
          {shown.map((n) =>
            n.kind === "region" && n.box ? (
              <span
                key={n.id}
                className={styles.box}
                style={boxStyle(n.box)}
                data-testid="note-badge"
                data-number={n.number}
              >
                <span className={styles.badge}>{n.number}</span>
              </span>
            ) : (
              <span
                key={n.id}
                className={`${styles.badge} ${styles.momentBadge}`}
                data-testid="note-badge"
                data-number={n.number}
              >
                {n.number}
              </span>
            ),
          )}
          {drawn ? (
            <span className={`${styles.box} ${styles.boxNew}`} style={boxStyle(drawn)} />
          ) : null}
        </div>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          disabled={!version.url}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => {
            step(-1);
          }}
          aria-label="Back one frame"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => {
            step(1);
          }}
          aria-label="Forward one frame"
        >
          <ChevronRight aria-hidden="true" />
        </button>
        <span className={styles.timecode} data-testid="timecode">
          {timecode(time, fps)}
          <span className={styles.muted}> / {timecode(duration, fps)}</span>
        </span>
      </div>
      <div className={styles.scrubber}>
        <input
          type="range"
          aria-label="Position"
          min={0}
          max={duration || 1}
          step={1 / fps}
          value={Math.min(time, duration || 1)}
          onChange={(e) => {
            videoRef.current?.pause();
            setPlaying(false);
            onTime(Number(e.target.value));
          }}
        />
        {duration > 0
          ? notes
              .filter((n) => n.tS !== null)
              .map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={styles.mark}
                  style={{ left: `${(((n.tS ?? 0) / duration) * 100).toFixed(2)}%` }}
                  onClick={() => {
                    onTime(n.tS ?? 0);
                  }}
                  aria-label={`Go to note ${n.number}`}
                >
                  {n.number}
                </button>
              ))
          : null}
      </div>
    </div>
  );
}

function boxStyle(b: NoteBox): React.CSSProperties {
  return {
    left: `${b.x * 100}%`,
    top: `${b.y * 100}%`,
    width: `${b.w * 100}%`,
    height: `${b.h * 100}%`,
  };
}

function sameOriginOrStorage(url: string | null): boolean {
  if (!url) return false;
  return url.startsWith("/") || url.includes("/storage/v1/object/");
}
