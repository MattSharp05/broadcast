"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { rework, type FactoryResult } from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import type { ProductionPage } from "@/lib/db/factory-page";
import { estimateFaceClips, usd } from "@/lib/domain/factory/budget";
import {
  REWORK_LABELS,
  isPaidRework,
  slotsTouched,
  type ReworkTarget,
  type ScriptLine,
} from "@/lib/domain/factory/rework";
import styles from "./factory.module.css";

type Run = <T>(
  fn: () => Promise<FactoryResult<T>>,
  success?: string | ((v: T) => string | null),
) => void;

/**
 * Section 7: choose what to redo. Redoing anything but an avatar slot never regenerates the paid
 * avatar clips (the proxy returns the kept clip for each slot). Only "An avatar slot" pays again,
 * and it shows its cost first.
 */
export function ReworkSection({
  video,
  run,
  pending,
}: {
  video: ProductionPage;
  run: Run;
  pending: boolean;
}) {
  const [target, setTarget] = useState<ReworkTarget>("voice");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const lines = (video.script as { lines?: ScriptLine[] } | null)?.lines ?? [];
  const quoteStep = video.steps.find((s) => s.step === "face_quote");
  const slots =
    (quoteStep?.output as { slots?: { slot: string; seconds: number }[] } | null)?.slots ?? [];
  const model = (quoteStep?.output as { model?: string } | null)?.model ?? "placeholder";
  const slot = slots.find((s) => s.slot === ref);
  const slotQuote = slot ? estimateFaceClips(model, [slot], 0).totalUsd : 0;
  const touched = target === "script_line" && ref ? slotsTouched(lines, [ref]) : [];
  const started = video.status !== "draft";
  const canRework = started && video.status !== "scheduled";
  const targets = (Object.keys(REWORK_LABELS) as ReworkTarget[]).filter(
    (t) => t !== "avatar_slot" || video.useAvatar,
  );
  const keptClips = video.jobs.filter((j) => j.status === "completed").length;

  return (
    <section id="rework" className={styles.section} aria-labelledby="rework-h">
      <div className={styles.sectionHead}>
        <h2 id="rework-h">7. Rework</h2>
      </div>
      {!started ? (
        <p className={styles.help}>
          Once the video has started you can redo script lines, a scene, the voice, the music, the
          caption or an avatar slot.
        </p>
      ) : video.status === "scheduled" ? (
        <p className={styles.help}>
          This video is queued. Remove the post on the Workflow tab to rework it, or remake it.
        </p>
      ) : (
        <>
          <p className={styles.help}>
            {video.useAvatar
              ? keptClips > 0
                ? `Redoing anything but an avatar slot keeps the ${keptClips} paid avatar clip${keptClips === 1 ? "" : "s"}: they are reused, never generated again.`
                : "Redoing anything but an avatar slot never pays for avatar clips again: once made, they are kept and reused."
              : "Every rework here is free."}
          </p>
          <div className={styles.row}>
            <label className={styles.field}>
              What to redo
              <select
                aria-label="What to redo"
                className={styles.select}
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value as ReworkTarget);
                  setRef("");
                }}
                disabled={!canRework || pending}
              >
                {targets.map((t) => (
                  <option key={t} value={t}>
                    {REWORK_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            {target === "script_line" ? (
              <label className={styles.field} style={{ flex: "1 1 220px" }}>
                Line
                <select
                  aria-label="Line"
                  className={styles.select}
                  value={ref}
                  onChange={(e) => {
                    setRef(e.target.value);
                  }}
                >
                  <option value="">All lines</option>
                  {lines.map((l, i) => (
                    <option key={l.id} value={l.id}>
                      {i + 1}. {l.text.slice(0, 60)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {target === "scene" ? (
              <label className={styles.field}>
                Scene
                <select
                  aria-label="Scene"
                  className={styles.select}
                  value={ref}
                  onChange={(e) => {
                    setRef(e.target.value);
                  }}
                >
                  <option value="">Choose a scene</option>
                  {["s1", "s2", "s3", "s4"].map((s) => (
                    <option key={s} value={s}>
                      Scene {s.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {target === "avatar_slot" ? (
              <label className={styles.field}>
                Slot
                <select
                  aria-label="Slot"
                  className={styles.select}
                  value={ref}
                  onChange={(e) => {
                    setRef(e.target.value);
                  }}
                >
                  <option value="">Choose a slot</option>
                  {slots.map((s) => (
                    <option key={s.slot} value={s.slot}>
                      {s.slot} ({s.seconds} s)
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <label className={styles.field}>
            What should change
            <input
              className={styles.input}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
              placeholder="Warmer, slower, a shorter hook…"
            />
          </label>
          {touched.length ? (
            <div className={styles.notice} role="note">
              The avatar speaks this line (slot {touched.join(", ")}). The new wording is used for
              the voiceover; the avatar clip is kept. To change what the avatar says, redo the
              avatar slot (paid).
            </div>
          ) : null}
          <div className={styles.row}>
            <Button
              disabled={
                !canRework || pending || ((target === "avatar_slot" || target === "scene") && !ref)
              }
              onClick={() => {
                run(
                  () => rework(video.id, { target, ref: ref || null, note, quoteUsd: slotQuote }),
                  target === "caption"
                    ? "Rewrite the caption below."
                    : `Redoing: ${REWORK_LABELS[target].toLowerCase()}.`,
                );
              }}
              data-paid={isPaidRework(target)}
            >
              <RotateCcw aria-hidden="true" />
              {isPaidRework(target)
                ? `Redo this avatar slot, paid ${ref ? usd(slotQuote) : ""}`.trim()
                : `Redo ${REWORK_LABELS[target].toLowerCase()}`}
            </Button>
            <span className={isPaidRework(target) ? styles.paid : styles.free}>
              {isPaidRework(target) ? "Paid" : "Free"}
            </span>
          </div>
        </>
      )}
      {video.reworks.length ? (
        <ul className={styles.lines} data-testid="reworks">
          {video.reworks.map((r) => (
            <li key={r.id}>
              {REWORK_LABELS[r.target as ReworkTarget]}
              {r.ref ? ` ${r.ref}` : ""}
              {r.note ? `: ${r.note}` : ""} ({r.status}
              {r.quoteUsd > 0 ? `, ${usd(r.quoteUsd)}` : ""})
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
