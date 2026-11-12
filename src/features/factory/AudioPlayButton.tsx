"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./factory.module.css";

/** One play button for a sample. Only one sample plays at a time across the page. */
let current: HTMLAudioElement | null = null;

export function AudioPlayButton({ src, label }: { src: string | null; label: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = ref.current;
    return () => {
      audio?.pause();
    };
  }, []);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!src) return;
    let audio = ref.current;
    if (!audio) {
      audio = new Audio(src);
      audio.addEventListener("ended", () => {
        setPlaying(false);
      });
      audio.addEventListener("pause", () => {
        setPlaying(false);
      });
      audio.addEventListener("play", () => {
        setPlaying(true);
      });
      ref.current = audio;
    }
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (current && current !== audio) current.pause();
    current = audio;
    void audio.play().catch(() => {
      setPlaying(false);
    });
  }

  return (
    <button
      type="button"
      className={styles.play}
      onClick={toggle}
      disabled={!src}
      aria-label={src ? `${playing ? "Pause" : "Play"} ${label}` : `No sample for ${label} yet`}
      title={src ? undefined : "No sample clip yet"}
      data-playing={playing}
    >
      {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
    </button>
  );
}
