import { X } from "lucide-react";
import styles from "./Tag.module.css";

interface TagProps {
  label: string;
  /** When given, a × button appears on hover and focus. */
  onRemove?: () => void;
}

/** 22px tag on the --hover ground, 4px radius. */
export function Tag({ label, onRemove }: TagProps) {
  return (
    <span className={styles.tag} data-removable={onRemove ? "" : undefined}>
      {label}
      {onRemove ? (
        <button
          type="button"
          className={styles.remove}
          aria-label={`Remove tag ${label}`}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
