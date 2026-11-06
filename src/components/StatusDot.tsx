import type { ReactNode } from "react";
import styles from "./StatusDot.module.css";

export type StatusTone = "good" | "warn" | "bad" | "accent" | "neutral";

interface StatusDotProps {
  tone: StatusTone;
  /** The status word ("Ready", "Needs attention"). Without it only the dot renders. */
  children?: ReactNode;
  className?: string;
}

/** A 7px dot in the state colour, plus the status word in the same colour. No pills. */
export function StatusDot({ tone, children, className }: StatusDotProps) {
  const cls = [styles.status, className].filter(Boolean).join(" ");
  if (children === undefined) {
    return <span className={`${cls} ${styles.bare}`} data-tone={tone} aria-hidden="true" />;
  }
  return (
    <span className={cls} data-tone={tone}>
      {children}
    </span>
  );
}
