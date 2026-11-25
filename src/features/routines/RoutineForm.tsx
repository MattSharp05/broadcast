"use client";

import { ArrowLeft, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  saveRoutineAction,
  saveTemplateAction,
  type RoutineForm as FormValues,
} from "@/app/(app)/routines/actions";
import { Button, ButtonLink } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { Toast } from "@/components/Toast";
import { whenLabel } from "@/lib/domain/format";
import {
  cadenceLabel,
  fromLocalInput,
  layoutSlots,
  scheduleIssues,
  type RoutineConfig,
} from "@/lib/domain/routines";
import { cleanTags } from "@/lib/domain/tags";
import type { FormOptions } from "@/lib/routines/page";
import { ConfigEditor } from "./ConfigEditor";
import styles from "./routines.module.css";

const LEADS = [
  [60, "1 hour"],
  [120, "2 hours"],
  [180, "3 hours"],
  [360, "6 hours"],
  [720, "12 hours"],
  [1440, "1 day"],
] as const;

export interface RoutineFormInitial {
  id: string | null;
  name: string;
  templateId: string | null;
  startsAt: string;
  endsAt: string;
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  leadMinutes: number;
  maxParallel: number;
  approval: "auto" | "review";
  budgetUsd: string;
  tags: string[];
  accountIds: string[];
  config: RoutineConfig;
}

/** New or edit routine: when, how often, where, the approval setting, and the planner's rules. */
export function RoutineForm({
  initial,
  options,
  timezone,
  now,
}: {
  initial: RoutineFormInitial;
  options: FormOptions;
  timezone: string;
  now: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<RoutineFormInitial>(initial);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [templateName, setTemplateName] = useState("");
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ message: string; id: number; tone?: "error" } | null>(null);
  const set = (patch: Partial<RoutineFormInitial>) => {
    setV((old) => ({ ...old, ...patch }));
  };
  const notify = (message: string, tone?: "error") => {
    setToast({ message, id: Date.now(), tone });
  };

  const windowEnd = v.windowEnd === "00:00" ? "24:00" : v.windowEnd;
  const schedule = useMemo(() => {
    const startsAt = fromLocalInput(v.startsAt, timezone) ?? new Date(NaN);
    const endsAt = fromLocalInput(v.endsAt, timezone) ?? new Date(NaN);
    const input = { ...v, windowEnd, startsAt, endsAt, timezone };
    const issues = scheduleIssues(input);
    const slots = issues.length ? [] : layoutSlots(input);
    return { issues, slots };
  }, [v, windowEnd, timezone]);

  const firstPost = schedule.slots[0]?.postAt ?? null;
  const firstBuild = schedule.slots[0]?.buildAt ?? null;
  const nowDate = new Date(now);

  const save = () => {
    const form: FormValues = { ...v, windowEnd, tags: cleanTags(tagsText.split(",")) };
    start(async () => {
      const res = await saveRoutineAction(v.id, form);
      if (!res.ok) notify(res.error, "error");
      else router.push(`/routines/${res.value}`);
    });
  };

  const saveAsTemplate = () => {
    start(async () => {
      const res = await saveTemplateAction(null, {
        name: templateName,
        description: `Saved from the routine "${v.name}".`,
        config: v.config,
      });
      if (!res.ok) notify(res.error, "error");
      else {
        set({ templateId: res.value });
        setTemplateName("");
        notify(`Saved the template "${templateName}". Pick it for the next routine.`);
      }
    });
  };

  return (
    <>
      <PageHeader
        title={v.id ? `Edit ${initial.name}` : "New routine"}
        actions={
          <ButtonLink href={v.id ? `/routines/${v.id}` : "/routines"} variant="ghost">
            <ArrowLeft aria-hidden="true" />
            {v.id ? "Back to the routine" : "Routines"}
          </ButtonLink>
        }
      />
      <div className={`${styles.page} ${styles.narrow}`}>
        {options.templates.length ? (
          <section className={styles.section} aria-labelledby="tpl-h">
            <div className={styles.sectionHead}>
              <h2 id="tpl-h">Start from a template</h2>
            </div>
            <label className={styles.field} style={{ maxWidth: 360 }}>
              Template
              <select
                className={styles.select}
                value={v.templateId ?? ""}
                onChange={(e) => {
                  const t = options.templates.find((x) => x.id === e.target.value);
                  set({ templateId: t?.id ?? null, ...(t ? { config: t.config } : {}) });
                }}
              >
                <option value="">None</option>
                {options.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <p className={styles.help}>
              Fills in the references, mix, styles, voices, music and rules below. Changing them
              here doesn&apos;t change the template.
            </p>
          </section>
        ) : null}

        <section className={styles.section} aria-labelledby="when-h">
          <div className={styles.sectionHead}>
            <h2 id="when-h">When and where</h2>
          </div>
          <label className={styles.field}>
            Name
            <input
              className={styles.input}
              value={v.name}
              maxLength={80}
              placeholder="Weekend brainteasers on @codingjourney"
              onChange={(e) => {
                set({ name: e.target.value });
              }}
            />
          </label>
          <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ padding: 0, marginBottom: 6 }}>Accounts</legend>
            <div className={styles.checks}>
              {options.accounts.map((a) => (
                <label key={a.id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={v.accountIds.includes(a.id)}
                    onChange={() => {
                      set({
                        accountIds: v.accountIds.includes(a.id)
                          ? v.accountIds.filter((x) => x !== a.id)
                          : [...v.accountIds, a.id],
                      });
                    }}
                  />
                  <span>
                    @{a.handle}
                    {a.brand ? <small>{a.brand}</small> : null}
                  </span>
                </label>
              ))}
            </div>
            {options.accounts.length === 0 ? (
              <span className={styles.muted}>Add an account first (Accounts tab).</span>
            ) : null}
          </fieldset>
          <div className={styles.grid}>
            <label className={styles.field}>
              Starts
              <input
                className={styles.input}
                type="datetime-local"
                value={v.startsAt}
                onChange={(e) => {
                  set({ startsAt: e.target.value });
                }}
              />
            </label>
            <label className={styles.field}>
              Ends
              <input
                className={styles.input}
                type="datetime-local"
                value={v.endsAt}
                onChange={(e) => {
                  set({ endsAt: e.target.value });
                }}
              />
            </label>
            <label className={styles.field}>
              Posts a day, per account
              <input
                className={styles.input}
                type="number"
                min={1}
                max={25}
                value={v.postsPerDay}
                onChange={(e) => {
                  set({ postsPerDay: Number(e.target.value) });
                }}
              />
            </label>
            <label className={styles.field}>
              Daily window from
              <input
                className={styles.input}
                type="time"
                value={v.windowStart}
                onChange={(e) => {
                  set({ windowStart: e.target.value });
                }}
              />
            </label>
            <label className={styles.field}>
              Until (00:00 is midnight)
              <input
                className={styles.input}
                type="time"
                value={v.windowEnd === "24:00" ? "00:00" : v.windowEnd}
                onChange={(e) => {
                  set({ windowEnd: e.target.value });
                }}
              />
            </label>
          </div>
          <p className={styles.preview} data-testid="schedule-preview">
            {schedule.issues.length ? (
              <span className={styles.error}>{schedule.issues[0]?.message}</span>
            ) : (
              <>
                <b>{schedule.slots.length} videos</b> (
                {cadenceLabel(v.postsPerDay, v.windowStart, windowEnd)}, {timezone}). First post{" "}
                {firstPost ? whenLabel(firstPost, nowDate, timezone) : ""}, its video starts{" "}
                {firstBuild ? whenLabel(firstBuild, nowDate, timezone) : ""}.
              </>
            )}
          </p>
        </section>

        <section className={styles.section} aria-labelledby="run-h">
          <div className={styles.sectionHead}>
            <h2 id="run-h">Building and posting</h2>
          </div>
          <div className={styles.choice} role="radiogroup" aria-label="When a video is ready">
            {(
              [
                [
                  "auto",
                  "Post automatically",
                  "A finished video that passes every check is scheduled at its slot.",
                ],
                [
                  "review",
                  "Wait for my approval",
                  "Finished videos wait on this routine's page until you approve them.",
                ],
              ] as const
            ).map(([key, label, help]) => (
              <label key={key} className={styles.option} data-selected={v.approval === key}>
                <input
                  type="radio"
                  name="approval"
                  value={key}
                  checked={v.approval === key}
                  onChange={() => {
                    set({ approval: key });
                  }}
                />
                <span>
                  <strong>{label}</strong>
                  <span>{help}</span>
                </span>
              </label>
            ))}
          </div>
          <div className={styles.grid}>
            <label className={styles.field}>
              Start each video
              <select
                className={styles.select}
                value={v.leadMinutes}
                onChange={(e) => {
                  set({ leadMinutes: Number(e.target.value) });
                }}
              >
                {LEADS.map(([m, label]) => (
                  <option key={m} value={m}>
                    {label} before it posts
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Videos built at once
              <input
                className={styles.input}
                type="number"
                min={1}
                max={10}
                value={v.maxParallel}
                onChange={(e) => {
                  set({ maxParallel: Number(e.target.value) });
                }}
              />
            </label>
            <label className={styles.field}>
              Budget for paid clips, USD (empty: the factory caps only)
              <input
                className={styles.input}
                type="number"
                min={0}
                step="0.5"
                value={v.budgetUsd}
                onChange={(e) => {
                  set({ budgetUsd: e.target.value });
                }}
              />
            </label>
            <label className={styles.field}>
              Tags on every video (comma separated)
              <input
                className={styles.input}
                value={tagsText}
                placeholder="Trip, Weekend test"
                onChange={(e) => {
                  setTagsText(e.target.value);
                }}
              />
            </label>
          </div>
        </section>

        <ConfigEditor
          value={v.config}
          onChange={(config) => {
            set({ config });
          }}
          options={options}
          slotCount={schedule.slots.length || undefined}
        />

        <section className={styles.section}>
          <div className={styles.actions}>
            <Button variant="primary" disabled={pending} onClick={save}>
              <Save aria-hidden="true" />
              {v.id ? "Save changes" : "Save routine"}
            </Button>
            <span className={styles.help}>
              Saving lays out the posting schedule. Nothing is made until you plan the videos and
              approve the plan.
            </span>
          </div>
          <div className={styles.row}>
            <input
              className={styles.input}
              style={{ maxWidth: 280 }}
              aria-label="Template name"
              placeholder="Template name"
              value={templateName}
              onChange={(e) => {
                setTemplateName(e.target.value);
              }}
            />
            <Button disabled={pending || !templateName.trim()} onClick={saveAsTemplate}>
              Save rules as a template
            </Button>
          </div>
        </section>
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
