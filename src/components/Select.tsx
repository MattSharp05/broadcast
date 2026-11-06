import type { SelectHTMLAttributes } from "react";
import styles from "./Select.module.css";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Visible label before the select ("Tag", "Status"). Without it, pass aria-label. */
  label?: string;
}

/** Native select styled as a 34px control with a chevron. */
export function Select({ label, className, ...rest }: SelectProps) {
  const select = (
    <select className={[styles.select, className].filter(Boolean).join(" ")} {...rest} />
  );
  if (!label) return select;
  return (
    <label className={styles.label}>
      {label}
      {select}
    </label>
  );
}
