import { CircleAlert, CircleCheck } from "lucide-react";
import { CHECK_LABELS, type DeliveryCheck } from "@/lib/domain/factory/delivery";
import styles from "./studio.module.css";

/** Each delivery check as pass or fail, with what to fix. */
export function ChecksPanel({ checks }: { checks: DeliveryCheck[] }) {
  return (
    <ul className={styles.checks} data-testid="checks">
      {checks.map((c) => (
        <li key={c.key} className={styles.checkItem} data-check={c.key} data-ok={c.ok}>
          {c.ok ? (
            <CircleCheck aria-label="Passes" className={styles.checkIcon} />
          ) : (
            <CircleAlert aria-label="Fails" className={styles.checkIcon} />
          )}
          <span className={styles.checkBody}>
            <span>{CHECK_LABELS[c.key]}</span>
            {c.ok ? null : <span className={styles.checkWhy}>{c.message}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
