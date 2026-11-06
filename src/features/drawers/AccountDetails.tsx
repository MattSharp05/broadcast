"use client";

import { Check, Copy, ExternalLink, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/Button";
import { platformName } from "@/components/PlatformGlyph";
import { StatusDot, type StatusTone } from "@/components/StatusDot";
import type { AccountState } from "@/lib/domain/canvas";
import { STATUS_LABELS } from "@/lib/domain/accounts";
import {
  DAILY_POST_LIMIT,
  FOLLOWER_DAYS,
  daysLeft,
  followerChange,
  permissionsLabel,
  type AccountDetail,
} from "@/lib/domain/details";
import { compactCount, shortDate } from "@/lib/domain/format";
import { Reconnect } from "./account/Reconnect";
import { SlotsEditor } from "./account/slots";
import { FollowersChart } from "./charts";
import styles from "./drawers.module.css";
import { Numbers, Row, UsedBar } from "./previews";
import type { OnQueueChanged, QueueActions } from "./edit-types";
import type { DetailClock } from "./types";

const TONES: Record<AccountState, StatusTone> = {
  ready: "good",
  needs_attention: "warn",
  not_connected: "neutral",
};

/** "instagram.com/codingjourney" from the profile URL. */
export function profileLabel(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

/** Only http(s) links are rendered as links (the vault URL is typed in by the user). */
function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function tokenLabel(account: AccountDetail, clock: DetailClock): string {
  const c = account.connection;
  if (!c) {
    return account.platform === "fake"
      ? "None stored (Sandbox example account)"
      : "None stored. Connect the account to get one.";
  }
  if (!c.expiresAt) return "Stored, no expiry date";
  const days = daysLeft(c.expiresAt, clock.now);
  if (days < 0) return `Expired on ${shortDate(c.expiresAt, clock.timezone)}`;
  return `Renews automatically, ${days === 1 ? "1 day" : `${days} days`} left`;
}

/** "Copy link": copies the URL and says so for a moment. */
export function CopyLinkButton({ url, label = "Copy link" }: { url: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    timer.current = setTimeout(() => {
      setState("idle");
    }, 2000);
  }

  return (
    <Button variant="ghost" onClick={() => void copy()} data-copy-url={url}>
      {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-live="polite">
        {state === "copied" ? "Link copied" : state === "failed" ? "Couldn't copy" : label}
      </span>
    </Button>
  );
}

/** The account drawer's body: profile link, followers, activity, slots, connection, description. */
export function AccountDetails({
  account: a,
  clock,
  actions,
  onChanged,
}: {
  account: AccountDetail;
  clock: DetailClock;
  /** Editing the slots (BC-18); read-only without. */
  actions?: QueueActions;
  onChanged?: OnQueueChanged;
}) {
  const platform = platformName(a.platform);
  const change = followerChange(a.followerSeries);
  const vault = safeHref(a.vaultUrl);
  return (
    <>
      <div className={styles.actions}>
        <ButtonLink
          variant="primary"
          href={a.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-profile-link=""
        >
          <ExternalLink aria-hidden="true" />
          Open @{a.handle} on {platform}
        </ButtonLink>
        <CopyLinkButton url={a.profileUrl} />
      </div>

      <Reconnect account={a} />

      <section className={styles.section} aria-labelledby={`followers-${a.id}`}>
        <h3 id={`followers-${a.id}`}>Followers, last {FOLLOWER_DAYS} days</h3>
        <div className={styles.big}>
          <b>{(a.followers ?? 0).toLocaleString("en-GB")}</b>
          {change !== null && change !== 0 ? (
            <span data-tone={change > 0 ? "good" : "bad"}>
              {change > 0 ? "+" : "−"}
              {Math.abs(change).toLocaleString("en-GB")}
            </span>
          ) : null}
        </div>
        <FollowersChart series={a.followerSeries} />
      </section>

      <Numbers
        grid
        name="activity"
        items={[
          { label: "Views, 7 days", value: compactCount(a.views7d) },
          { label: "Posts, 7 days", value: String(a.posts7d) },
          { label: "In backlog", value: String(a.backlog) },
        ]}
      />

      {actions && onChanged ? (
        <SlotsEditor key={a.id} account={a} actions={actions} onChanged={onChanged} />
      ) : (
        <section className={styles.section} data-section="slots">
          <h3>Daily posting slots</h3>
          {a.slots.length > 0 ? (
            <ul className={styles.slots}>
              {a.slots.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No slots yet, so queued videos wait without a time.</p>
          )}
        </section>
      )}

      <section className={styles.section} data-section="connection">
        <h3>Connection</h3>
        <dl className={styles.dl}>
          <Row label="Status">
            <StatusDot tone={TONES[a.status]}>{STATUS_LABELS[a.status]}</StatusDot>
          </Row>
          <Row label="Permissions">
            {a.connection
              ? permissionsLabel(a.connection.permissions)
              : a.platform === "fake"
                ? "Sandbox example account"
                : "Not granted yet"}
          </Row>
          <Row label="Access token">{tokenLabel(a, clock)}</Row>
          <Row label="Posts used today">
            <span className={styles.usedRow}>
              {a.postsUsed24h} of {DAILY_POST_LIMIT}
              <UsedBar used={a.postsUsed24h} />
            </span>
          </Row>
          <Row label="Profile">
            <a href={a.profileUrl} target="_blank" rel="noopener noreferrer">
              {profileLabel(a.profileUrl)}
            </a>
          </Row>
          <Row label="Login">
            {vault ? (
              <a href={vault} target="_blank" rel="noopener noreferrer" data-vault-link="">
                Open in password manager
              </a>
            ) : (
              <span className={styles.muted}>No vault link</span>
            )}
          </Row>
        </dl>
      </section>

      <section className={styles.section} data-section="description">
        <h3>Description</h3>
        {a.description ? (
          <p className={styles.prose}>{a.description}</p>
        ) : (
          <p className={styles.muted}>
            <Info aria-hidden="true" className={styles.inlineIcon} />
            No description yet. Add one on the Accounts tab.
          </p>
        )}
      </section>
    </>
  );
}
