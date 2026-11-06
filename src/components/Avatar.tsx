import type { CSSProperties } from "react";
import { initials } from "@/lib/domain/canvas";
import styles from "./Avatar.module.css";
import { PlatformGlyph } from "./PlatformGlyph";

interface AvatarProps {
  handle: string;
  platform: string;
  /** 1–6: the --avatar-n colour (see avatarIndex). */
  colour: number;
  /** Diameter in px (36 in tables, 42 on canvas headers). */
  size?: number;
  className?: string;
}

/** A round avatar with the handle's initials and a small platform badge. */
export function Avatar({ handle, platform, colour, size = 36, className }: AvatarProps) {
  const style = {
    "--avatar-size": `${size}px`,
    "--avatar-bg": `var(--avatar-${colour})`,
  } as CSSProperties;
  return (
    <span
      className={[styles.avatar, className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
    >
      {initials(handle)}
      <span className={styles.badge}>
        <PlatformGlyph platform={platform} />
      </span>
    </span>
  );
}
