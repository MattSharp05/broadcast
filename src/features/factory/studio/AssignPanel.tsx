"use client";

import { CalendarClock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { newVideo, scheduleVersion } from "@/app/(app)/factory/actions";
import { Button, ButtonLink } from "@/components/Button";
import type { PackView, VersionView } from "@/lib/db/studio-page";
import type { StudioTabProps } from "./tabs";
import factory from "../factory.module.css";
import styles from "./studio.module.css";

type Kind = "next" | "pinned" | "queue";

/** "2026-11-26T18:00" → "Thu 26 Nov, 18:00" (the time as typed, in the workspace's zone). */
export function pinnedLabel(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return local;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const day = new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `${day.replace(",", "")}, ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/** What the button does, in words ("Schedule v3 for @maya.explains, Tomorrow, 18:00"). */
export function scheduleLabel(input: {
  version: number;
  handle: string;
  kind: Kind;
  nextSlot: string | null;
  local: string;
}): string {
  const v = `v${input.version}`;
  if (input.kind === "pinned") {
    return input.local
      ? `Schedule ${v} for @${input.handle}, ${pinnedLabel(input.local)}`
      : `Schedule ${v} for @${input.handle}`;
  }
  if (!input.nextSlot) return `Add ${v} to @${input.handle}'s backlog`;
  return input.kind === "next"
    ? `Schedule ${v} for @${input.handle}, ${input.nextSlot}`
    : `Add ${v} to the end of @${input.handle}'s queue`;
}

/**
 * Assign and schedule (BC-43), below the pack on Ready to post. One video goes to one account:
 * the video's own account schedules, another offers "Remake for …". Only this click makes a post.
 */
export function AssignPanel({
  video,
  options,
  version,
  pack,
  run,
  pending,
}: Pick<StudioTabProps, "video" | "options" | "run" | "pending"> & {
  version: VersionView;
  pack: PackView | null;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(video.accountId ?? options.accounts[0]?.id ?? "");
  const [kind, setKind] = useState<Kind>("next");
  const [local, setLocal] = useState("");
  const account = options.accounts.find((a) => a.id === accountId);
  const otherAccount = Boolean(video.accountId && accountId !== video.accountId);
  const scheduledHere = Boolean(version.mediaId && version.mediaId === video.mediaId);

  if (video.post) {
    return (
      <section
        className={`${styles.panel} ${styles.assign}`}
        aria-labelledby="assign-h"
        id="assign"
      >
        <div className={styles.sectionHead}>
          <h2 id="assign-h">Assign and schedule</h2>
        </div>
        <p className={styles.help} data-testid="scheduled">
          {scheduledHere ? `v${version.number} is` : "This video is"} scheduled on{" "}
          <b>@{video.post.handle}</b>
          {video.post.when ? (
            <>
              , <b>{video.post.when}</b>
            </>
          ) : (
            ", waiting for a slot"
          )}
          . It shows on the Workflow canvas like any post.
        </p>
        <div className={styles.row}>
          <ButtonLink href="/workflow">Open the Workflow</ButtonLink>
        </div>
      </section>
    );
  }

  const ready = Boolean(pack?.readyAt);
  const label = account
    ? scheduleLabel({
        version: version.number,
        handle: account.handle,
        kind,
        nextSlot: account.nextSlot,
        local,
      })
    : "Schedule";

  return (
    <section className={`${styles.panel} ${styles.assign}`} aria-labelledby="assign-h" id="assign">
      <div className={styles.sectionHead}>
        <h2 id="assign-h">Assign and schedule</h2>
      </div>
      <p className={styles.help}>
        One video goes to one account. To post it on another account, remake it there (new wording,
        hook and voice).
      </p>
      <div className={styles.row}>
        <label className={styles.field} style={{ flex: "1 1 220px" }}>
          Account
          <select
            className={styles.select}
            value={accountId}
            disabled={pending}
            onChange={(e) => {
              setAccountId(e.target.value);
            }}
          >
            {options.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.handle}
                {video.accountId === a.id ? " (this video's account)" : ""}
              </option>
            ))}
          </select>
        </label>
        {!otherAccount ? (
          <div className={styles.field}>
            When
            <div className={factory.segmented}>
              {(
                [
                  ["next", "Next free slot"],
                  ["pinned", "Pinned time"],
                  ["queue", "End of the queue"],
                ] as const
              ).map(([k, text]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  disabled={pending}
                  onClick={() => {
                    setKind(k);
                  }}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {!otherAccount && kind === "pinned" ? (
          <label className={styles.field}>
            Time ({options.timezone})
            <input
              className={factory.input}
              type="datetime-local"
              value={local}
              onChange={(e) => {
                setLocal(e.target.value);
              }}
            />
          </label>
        ) : null}
      </div>
      {!otherAccount && kind !== "pinned" && account ? (
        <p className={styles.help}>
          {account.nextSlot ? (
            kind === "next" ? (
              <>Pinned to @{account.handle}&apos;s next free slot, after its backlog.</>
            ) : (
              <>
                Joins the back of @{account.handle}&apos;s queue (now {account.nextSlot}) and moves
                if the queue changes.
              </>
            )
          ) : (
            <>@{account.handle} has no slots yet: the post waits in the backlog.</>
          )}
        </p>
      ) : null}
      {video.useAvatar && account && !(account.aiLabelDone && account.aiBioDone) ? (
        <div className={factory.notice} role="note">
          Avatar videos are disclosed as AI. On @{account.handle}, turn on Instagram&apos;s
          AI-generated profile label and add “AI creator” to the bio (Accounts → the account). Posts
          from the factory are marked is_ai_generated.
        </div>
      ) : null}
      <div className={styles.row}>
        {otherAccount && account ? (
          <Button
            disabled={pending}
            onClick={() => {
              run(
                () => newVideo({ remakeOf: video.id, accountId }),
                (id) => {
                  window.location.assign(`/factory/${id}`);
                  return null;
                },
              );
            }}
          >
            Remake for @{account.handle}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!ready || !account || pending || (kind === "pinned" && !local)}
            onClick={() => {
              run(
                () =>
                  scheduleVersion(video.id, version.id, {
                    accountId,
                    timing: kind === "pinned" ? { kind, local } : { kind },
                  }),
                (m) => {
                  router.refresh();
                  return m;
                },
              );
            }}
          >
            <CalendarClock aria-hidden="true" />
            {label}
          </Button>
        )}
        {!ready && !otherAccount ? (
          <span className={styles.meta}>Mark v{version.number} ready first.</span>
        ) : null}
      </div>
    </section>
  );
}
