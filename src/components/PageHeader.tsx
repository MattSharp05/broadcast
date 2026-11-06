import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

/**
 * One item of the stats line. The value is bold; the label sits after it
 * ("13 scheduled") or, with labelFirst, before it ("Next post in 9 h 46 min").
 */
export interface PageStat {
  value: ReactNode;
  label: string;
  labelFirst?: boolean;
  /** "bad" colours the value red, e.g. a non-zero failed count. */
  tone?: "bad";
}

interface PageHeaderProps {
  title: string;
  stats?: readonly PageStat[];
  actions?: ReactNode;
}

/** The white top bar of each tab: title, inline stats split by hairlines, actions on the right. */
export function PageHeader({ title, stats, actions }: PageHeaderProps) {
  return (
    <header className={styles.top}>
      <h1 className={styles.title}>{title}</h1>
      {stats && stats.length > 0 ? (
        <ul className={styles.stats}>
          {stats.map((s) => (
            <li key={s.label} data-tone={s.tone}>
              {s.labelFirst ? (
                <>
                  {s.label} <b>{s.value}</b>
                </>
              ) : (
                <>
                  <b>{s.value}</b> {s.label}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.grow} />
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
