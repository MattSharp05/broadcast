"use client";

import { useEffect, useMemo, useState } from "react";
import { compactCount } from "@/lib/domain/format";
import {
  METRICS,
  METRIC_LABELS,
  PERIODS,
  aggregatePerformance,
  changeLabel,
  type PerformanceData,
  type Period,
} from "@/lib/domain/performance";
import styles from "./PerformanceLine.module.css";

const STORAGE_KEY = "bc-performance-period";

function savedPeriod(): Period {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "30d" || v === "all" ? v : "7d";
  } catch {
    return "7d";
  }
}

/**
 * The slim line under the Workflow top bar (docs/DESIGN.md → Layout): views, reach, likes,
 * comments, shares, saves and followers for a period, over the accounts the Tag filter shows.
 * Split by hairlines, tabular numbers, "—" when nothing was reported; the change against the
 * period before in --good / --bad.
 */
export function PerformanceLine({
  data,
  accountIds,
  now,
}: {
  data: PerformanceData;
  accountIds: readonly string[];
  now: Date;
}) {
  const [period, setPeriod] = useState<Period>("7d");
  // The saved choice after hydration (the server renders the 7-day default).
  useEffect(() => {
    setPeriod(savedPeriod());
  }, []);
  const totals = useMemo(
    () => aggregatePerformance({ data, accountIds, period, now }),
    [data, accountIds, period, now],
  );
  const items = [...METRICS, "followers" as const];
  return (
    <div className={styles.line} data-testid="performance-line">
      <label className={styles.period}>
        <span className={styles.srOnly}>Period</span>
        <select
          value={period}
          aria-label="Period"
          onChange={(e) => {
            const v = e.target.value as Period;
            setPeriod(v);
            try {
              window.localStorage.setItem(STORAGE_KEY, v);
            } catch {
              // Per-viewer convenience only.
            }
          }}
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <ul className={styles.items}>
        {items.map((m) => {
          const t = totals[m];
          const c = changeLabel(t.change);
          return (
            <li key={m} data-metric={m}>
              <b>{t.value === null ? "—" : compactCount(t.value)}</b> {METRIC_LABELS[m]}
              {c ? (
                <span
                  className={styles.change}
                  data-tone={t.change !== null && t.change < 0 ? "bad" : "good"}
                >
                  {c}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
