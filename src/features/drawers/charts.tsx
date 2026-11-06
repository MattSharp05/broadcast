import { STAT_OFFSET_LABELS, type FollowerPoint, type StatSnapshot } from "@/lib/domain/details";
import { compactCount } from "@/lib/domain/format";
import styles from "./drawers.module.css";

/**
 * Inline SVG charts coloured from tokens (DESIGN.md → Charts): CSS classes set fill and stroke,
 * so both themes work without literal colours.
 */

const FW = 380;
const FH = 72;

/** Followers per day: an area line with the latest day emphasised. */
export function FollowersChart({ series }: { series: readonly FollowerPoint[] }) {
  if (series.length < 2) {
    return <p className={styles.muted}>Not enough history yet. Followers are recorded daily.</p>;
  }
  const values = series.map((p) => p.followers);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => [
    (i * FW) / (values.length - 1),
    FH - 6 - (FH - 14) * ((v - min) / (max - min || 1)),
  ]);
  const d = pts
    .map(([x, y], i) => `${i ? "L" : "M"}${(x ?? 0).toFixed(1)} ${(y ?? 0).toFixed(1)}`)
    .join(" ");
  const [lx, ly] = pts[pts.length - 1] ?? [0, 0];
  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${FW} ${FH}`}
      width="100%"
      role="img"
      aria-label={`Followers over the last ${series.length} days, from ${values[0]?.toLocaleString("en-GB")} to ${values[values.length - 1]?.toLocaleString("en-GB")}`}
      data-chart="followers"
    >
      <path className={styles.area} d={`${d} L${FW} ${FH} L0 ${FH} Z`} />
      <path className={styles.line} d={d} />
      <circle className={styles.dot} cx={lx} cy={ly} r={3.5} />
    </svg>
  );
}

const BW = 380;
const BH = 150;
const PAD_L = 8;
const PAD_B = 26;
const PAD_T = 20;

/** Views at each stats refresh: soft bars, the latest solid, refreshes still to come dashed. */
export function RefreshChart({ snapshots }: { snapshots: readonly StatSnapshot[] }) {
  const taken = snapshots.filter((s) => s.views !== null);
  const max = Math.max(1, ...taken.map((s) => s.views ?? 0));
  const latest = snapshots.reduce((at, s, i) => (s.views !== null ? i : at), -1);
  const slot = (BW - PAD_L * 2) / Math.max(1, snapshots.length);
  const base = BH - PAD_B;
  const label = snapshots
    .map((s) => `${STAT_OFFSET_LABELS[s.offset]}: ${s.views ?? (s.missed ? "missed" : "not yet")}`)
    .join(", ");
  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${BW} ${BH}`}
      width="100%"
      role="img"
      aria-label={`Views at each stats refresh. ${label}`}
      data-chart="refreshes"
    >
      <line className={styles.axis} x1={0} x2={BW} y1={base} y2={base} />
      {snapshots.map((s, i) => {
        const x = PAD_L + i * slot + slot * 0.2;
        const w = slot * 0.6;
        const name = STAT_OFFSET_LABELS[s.offset];
        if (s.views === null) {
          return (
            <g key={s.offset} data-bar={s.missed ? "missed" : "missing"}>
              <rect className={styles.missing} x={x} y={base - 20} width={w} height={20} rx={3} />
              <text x={x + w / 2} y={BH - 8} textAnchor="middle">
                {name}
              </text>
            </g>
          );
        }
        const h = Math.max(2, (base - PAD_T) * (s.views / max));
        return (
          <g key={s.offset} data-bar={i === latest ? "latest" : "taken"}>
            <rect
              className={i === latest ? styles.statBarLatest : styles.statBar}
              x={x}
              y={base - h}
              width={w}
              height={h}
              rx={3}
            />
            <text className={styles.value} x={x + w / 2} y={base - h - 6} textAnchor="middle">
              {compactCount(s.views)}
            </text>
            <text x={x + w / 2} y={BH - 8} textAnchor="middle">
              {name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
