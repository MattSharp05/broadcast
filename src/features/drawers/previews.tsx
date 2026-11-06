import type { ReactNode } from "react";
import { platformName } from "@/components/PlatformGlyph";
import { DAILY_POST_LIMIT, connectionNote, type PostStats } from "@/lib/domain/details";
import { ago, compactCount, inFrom, statCount, whenLabel } from "@/lib/domain/format";
import styles from "./drawers.module.css";
import type { DetailClock, DetailTarget } from "./types";

/**
 * Hover preview contents (mockup .pop): a post's time and numbers, an account's headline
 * numbers. The canvas puts them in a Popover; clicking opens the drawer with the rest.
 */

const STAT_ORDER: { key: keyof PostStats; label: string }[] = [
  { key: "views", label: "Views" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "shares", label: "Shares" },
  { key: "saves", label: "Saves" },
  { key: "reach", label: "Reach" },
];

/** One label–value line of a drawer's details list (inside a `dl`). */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Numbers with labels: a compact 3-column list (previews) or a ruled grid (drawers). */
export function Numbers({
  items,
  grid = false,
  name,
}: {
  items: { label: string; value: string }[];
  grid?: boolean;
  name?: string;
}) {
  return (
    <dl className={grid ? styles.mgrid : styles.kv} data-numbers={name}>
      {items.map((it) => (
        <div key={it.label}>
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function UsedBar({ used }: { used: number }) {
  const pct = Math.min(100, Math.max(2, (used / DAILY_POST_LIMIT) * 100));
  return (
    <span className={styles.bar} aria-hidden="true">
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Preview({ target, clock }: { target: DetailTarget; clock: DetailClock }) {
  const { now, timezone } = clock;

  if (target.kind === "account") {
    const a = target.account;
    return (
      <div data-preview="account">
        <h3 className={styles.popTitle}>@{a.handle}</h3>
        <p className={styles.small}>
          {a.brand} on {platformName(a.platform)}
        </p>
        <Numbers
          items={[
            { label: "Followers", value: compactCount(a.followers ?? 0) },
            { label: "Views, 7 days", value: compactCount(a.views7d) },
            { label: "Posts a day", value: String(a.slots.length) },
          ]}
        />
        <p className={styles.used}>
          {a.postsUsed24h} of {DAILY_POST_LIMIT} daily posts used
        </p>
        <UsedBar used={a.postsUsed24h} />
        <p className={styles.hint}>
          {connectionNote(a)} Click for analytics and a link to the profile.
        </p>
      </div>
    );
  }

  const { card, account, detail } = target;
  if (card.kind === "open") {
    return (
      <div data-preview="open">
        <h3 className={styles.popTitle}>Open slot</h3>
        <p className={styles.small}>
          {whenLabel(card.at, now, timezone)} on @{account.handle}
        </p>
        <p className={styles.hint}>
          The next video in this account&apos;s backlog fills it automatically.
        </p>
      </div>
    );
  }

  if (card.kind === "posted") {
    const stats = detail?.stats;
    return (
      <div data-preview="posted">
        <h3 className={styles.popTitle}>{card.title}</h3>
        <p className={styles.small}>Posted {ago(card.at, now)}</p>
        <Numbers
          items={STAT_ORDER.map(({ key, label }) => ({
            label,
            value: stats ? statCount(stats[key]) : "–",
          }))}
        />
        <p className={styles.hint}>
          {detail?.refreshedAt
            ? `Stats refreshed ${ago(detail.refreshedAt, now)}. Click for the full history.`
            : "No stats yet. The first refresh is 1 h after posting."}
        </p>
      </div>
    );
  }

  if (card.kind === "failed") {
    return (
      <div data-preview="failed">
        <h3 className={styles.popTitle}>{card.title}</h3>
        <p className={styles.small}>Failed {ago(card.at, now)}</p>
        <p className={styles.hint}>{detail?.error ?? card.reason}</p>
      </div>
    );
  }

  const when = card.at
    ? `${whenLabel(card.at, now, timezone)}, ${inFrom(card.at, now)}`
    : "No slot yet. Add a daily slot to schedule it.";
  const timing =
    card.kind === "pinned"
      ? "Pinned to this exact time."
      : card.kind === "paused"
        ? "Waiting for the account to be reconnected."
        : card.kind === "publishing"
          ? "Instagram is processing it."
          : "In a queue slot, so it moves up if an earlier video is removed.";
  return (
    <div data-preview={card.kind}>
      <h3 className={styles.popTitle}>{card.title}</h3>
      <p className={styles.small}>{when}</p>
      <p className={styles.hint}>{timing} Click for details.</p>
    </div>
  );
}
