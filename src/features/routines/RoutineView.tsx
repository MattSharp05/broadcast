"use client";

import {
  ArrowLeft,
  Check,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approvePlanAction,
  approveSlotAction,
  cancelRoutineAction,
  deleteRoutineAction,
  pauseRoutineAction,
  planRoutineAction,
  resumeRoutineAction,
  runRoutineNowAction,
  skipSlotAction,
  type RoutineResult,
} from "@/app/(app)/routines/actions";
import { Button, ButtonLink } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { StatusDot } from "@/components/StatusDot";
import { Tag } from "@/components/Tag";
import { Toast } from "@/components/Toast";
import { usd } from "@/lib/domain/factory/budget";
import { dayLabel, hm, sameLocalDay, whenLabel } from "@/lib/domain/format";
import { genreLabel } from "@/lib/domain/genres";
import { ROUTINE_STATUS_LABELS, SLOT_STATUS_LABELS, cadenceLabel } from "@/lib/domain/routines";
import type { RoutineDetail } from "@/lib/routines/page";
import styles from "./routines.module.css";
import { ROUTINE_TONES, SLOT_TONES } from "./tones";

export function RoutineView({
  detail,
  timezone,
  now,
}: {
  detail: RoutineDetail;
  timezone: string;
  now: string;
}) {
  const router = useRouter();
  const { routine: r, slots, counts } = detail;
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ message: string; id: number; tone?: "error" } | null>(null);
  const [prompt, setPrompt] = useState<{ text: string; reason: string } | null>(null);
  const nowDate = new Date(now);

  const run = <T,>(
    fn: () => Promise<RoutineResult<T>>,
    success: string | ((v: T) => string | null),
  ) => {
    start(async () => {
      const res = await fn();
      if (!res.ok) setToast({ message: res.error, id: Date.now(), tone: "error" });
      else {
        const msg = typeof success === "string" ? success : success(res.value);
        if (msg) setToast({ message: msg, id: Date.now() });
        router.refresh();
      }
    });
  };

  const plan = () => {
    run(
      () => planRoutineAction(r.id),
      (v) => {
        if (v.kind === "manual") {
          setPrompt({ text: v.prompt, reason: v.reason });
          return null;
        }
        if (v.kind === "error") return v.message;
        return v.kind === "fake" ? "Planned every video." : "The planner session started.";
      },
    );
  };

  const total = slots.length;
  const handles = detail.options.accounts
    .filter((a) => r.accountIds.includes(a.id))
    .map((a) => `@${a.handle}`);
  const template = detail.options.templates.find((t) => t.id === r.templateId);
  const editable = r.status === "draft" || r.status === "planned";

  return (
    <>
      <PageHeader
        title={r.name}
        stats={[
          { value: `${counts.posted} of ${total}`, label: "posted" },
          { value: String(counts.scheduled), label: "scheduled" },
          { value: String(counts.building), label: "building" },
          ...(counts.review ? [{ value: String(counts.review), label: "waiting for you" }] : []),
          ...(counts.failed
            ? [{ value: String(counts.failed), label: "failed", tone: "bad" as const }]
            : []),
          {
            value:
              r.budgetUsd !== null
                ? `${usd(detail.spentUsd)} of ${usd(r.budgetUsd)}`
                : usd(detail.spentUsd),
            label: "Spent",
            labelFirst: true,
          },
        ]}
        actions={
          <ButtonLink href="/routines" variant="ghost">
            <ArrowLeft aria-hidden="true" />
            Routines
          </ButtonLink>
        }
      />
      <div className={styles.page}>
        <section className={styles.section} aria-labelledby="summary-h">
          <div className={styles.sectionHead}>
            <h2 id="summary-h">Routine</h2>
            <StatusDot tone={ROUTINE_TONES[r.status]}>
              <span data-testid="routine-status">{ROUTINE_STATUS_LABELS[r.status]}</span>
            </StatusDot>
            <div className={styles.grow} />
            <div className={styles.actions}>
              {editable ? (
                <ButtonLink href={`/routines/${r.id}/edit`}>
                  <Pencil aria-hidden="true" />
                  Edit
                </ButtonLink>
              ) : null}
              {r.status === "draft" || r.status === "planning" ? (
                <Button variant="primary" disabled={pending} onClick={plan}>
                  <Sparkles aria-hidden="true" />
                  {r.status === "planning" ? "Plan again" : "Plan videos"}
                </Button>
              ) : null}
              {r.status === "planned" ? (
                <>
                  <Button disabled={pending} onClick={plan}>
                    <RefreshCw aria-hidden="true" />
                    Plan again
                  </Button>
                  <Button
                    variant="primary"
                    disabled={pending}
                    onClick={() => {
                      run(
                        () => approvePlanAction(r.id),
                        "Plan approved. Videos start as their slots come up.",
                      );
                    }}
                  >
                    <Check aria-hidden="true" />
                    Approve plan and start
                  </Button>
                </>
              ) : null}
              {r.status === "running" ? (
                <>
                  <Button
                    disabled={pending}
                    onClick={() => {
                      run(
                        () => runRoutineNowAction(r.id),
                        (m) => m,
                      );
                    }}
                  >
                    <RefreshCw aria-hidden="true" />
                    Run now
                  </Button>
                  <Button
                    disabled={pending}
                    onClick={() => {
                      run(
                        () => pauseRoutineAction(r.id),
                        "Paused. Videos already building carry on.",
                      );
                    }}
                  >
                    <Pause aria-hidden="true" />
                    Pause
                  </Button>
                </>
              ) : null}
              {r.status === "paused" ? (
                <Button
                  variant="primary"
                  disabled={pending}
                  onClick={() => {
                    run(() => resumeRoutineAction(r.id), "Running again.");
                  }}
                >
                  <Play aria-hidden="true" />
                  Resume
                </Button>
              ) : null}
              {r.status === "running" || r.status === "paused" || r.status === "planned" ? (
                <Button
                  variant="danger"
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Cancel this routine? Slots not scheduled yet are skipped; scheduled posts stay.",
                      )
                    )
                      run(() => cancelRoutineAction(r.id), "Cancelled.");
                  }}
                >
                  <X aria-hidden="true" />
                  Cancel routine
                </Button>
              ) : null}
              {r.status === "draft" || r.status === "done" || r.status === "cancelled" ? (
                <Button
                  variant="danger"
                  disabled={pending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Delete this routine? Its videos stay in the Content Factory.",
                      )
                    )
                      return;
                    start(async () => {
                      const res = await deleteRoutineAction(r.id);
                      if (res.ok) router.push("/routines");
                      else setToast({ message: res.error, id: Date.now(), tone: "error" });
                    });
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  Delete
                </Button>
              ) : null}
            </div>
          </div>
          <p className={styles.preview}>
            <b>{total} videos</b> for {handles.join(", ")},{" "}
            {cadenceLabel(r.postsPerDay, r.windowStart, r.windowEnd).toLowerCase()} from{" "}
            {r.windowStart} to {r.windowEnd === "24:00" ? "midnight" : r.windowEnd},{" "}
            {dayLabel(new Date(r.startsAt), nowDate, timezone)} {hm(new Date(r.startsAt), timezone)}{" "}
            to {dayLabel(new Date(r.endsAt), nowDate, timezone)} {hm(new Date(r.endsAt), timezone)}.
            Each video starts {Math.round(r.leadMinutes / 60)} h before it posts, at most{" "}
            {r.maxParallel} at once.{" "}
            {r.approval === "auto"
              ? "Finished videos post automatically."
              : "Finished videos wait for your approval."}
            {template ? ` Rules from the template "${template.name}".` : ""}
          </p>
          {r.tags.length ? (
            <div className={styles.row}>
              {r.tags.map((t) => (
                <Tag key={t} label={t} />
              ))}
            </div>
          ) : null}
          {r.planMessage ? (
            <div className={styles.banner} role="status">
              {r.planMessage}
              {r.planSessionUrl ? (
                <>
                  {" "}
                  <a
                    className={styles.link}
                    href={r.planSessionUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the planner session
                  </a>
                </>
              ) : null}
            </div>
          ) : null}
          {prompt ? (
            <>
              <p className={styles.help}>{prompt.reason}</p>
              <pre className={styles.prompt} data-testid="planner-prompt">
                {prompt.text}
              </pre>
            </>
          ) : null}
        </section>

        <div className={styles.tablewrap}>
          <table className={styles.table} data-testid="routine-slots">
            <thead>
              <tr>
                <th>Time</th>
                <th>Account</th>
                <th>Video</th>
                <th>Genre</th>
                <th>Style</th>
                <th>Voice</th>
                <th>Music</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {slots.map((s, i) => {
                const at = new Date(s.postAt);
                const prev = slots[i - 1];
                const newDay = !prev || !sameLocalDay(new Date(prev.postAt), at, timezone);
                return (
                  <SlotRows
                    key={s.id}
                    s={s}
                    newDay={newDay}
                    at={at}
                    now={nowDate}
                    timezone={timezone}
                    pending={pending}
                    onApprove={() => {
                      run(
                        () => approveSlotAction(s.id),
                        (m) => m,
                      );
                    }}
                    onSkip={() => {
                      run(() => skipSlotAction(s.id), "Skipped.");
                    }}
                  />
                );
              })}
            </tbody>
          </table>
          {slots.length === 0 ? (
            <div className={styles.empty}>No slots. Edit the dates.</div>
          ) : null}
        </div>
      </div>
      <Toast
        message={toast?.message ?? null}
        id={toast?.id}
        tone={toast?.tone}
        onDone={() => {
          setToast(null);
        }}
      />
    </>
  );
}

function SlotRows({
  s,
  newDay,
  at,
  now,
  timezone,
  pending,
  onApprove,
  onSkip,
}: {
  s: RoutineDetail["slots"][number];
  newDay: boolean;
  at: Date;
  now: Date;
  timezone: string;
  pending: boolean;
  onApprove: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      {newDay ? (
        <tr className={styles.day}>
          <td colSpan={9}>{dayLabel(at, now, timezone)}</td>
        </tr>
      ) : null}
      <tr data-slot-status={s.status} data-testid="routine-slot">
        <td className={styles.nowrap} title={whenLabel(at, now, timezone)}>
          {hm(at, timezone)}
        </td>
        <td className={styles.nowrap}>{s.account}</td>
        <td>
          <div className={styles.title}>
            {s.productionId ? (
              <Link href={`/factory/${s.productionId}`}>{s.title || "Untitled"}</Link>
            ) : (
              s.title || <span className={styles.muted}>Not planned yet</span>
            )}
          </div>
          {s.idea ? <div className={styles.sub}>{s.idea}</div> : null}
          {s.hook ? <div className={styles.sub}>Hook: {s.hook}</div> : null}
          {s.notes ? <div className={`${styles.sub} ${styles.muted}`}>{s.notes}</div> : null}
        </td>
        <td className={styles.nowrap}>{genreLabel(s.genre)}</td>
        <td className={styles.nowrap}>{s.style}</td>
        <td>{s.voice}</td>
        <td>{s.music}</td>
        <td>
          <StatusDot tone={SLOT_TONES[s.status]}>{SLOT_STATUS_LABELS[s.status]}</StatusDot>
          {s.message ? <div className={styles.sub}>{s.message}</div> : null}
        </td>
        <td className={styles.nowrap}>
          {s.status === "review" ? (
            <Button variant="primary" disabled={pending} onClick={onApprove}>
              <Check aria-hidden="true" />
              Approve
            </Button>
          ) : null}
          {s.status === "open" || s.status === "planned" || s.status === "review" ? (
            <Button variant="ghost" disabled={pending} onClick={onSkip}>
              Skip
            </Button>
          ) : null}
        </td>
      </tr>
    </>
  );
}
