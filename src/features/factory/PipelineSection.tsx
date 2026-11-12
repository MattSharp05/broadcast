"use client";

import { Check, Copy, ExternalLink, Play, RotateCcw } from "lucide-react";
import { useState } from "react";
import {
  approve,
  redo,
  setStepMode,
  startVideo,
  type FactoryResult,
} from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import { StatusDot } from "@/components/StatusDot";
import type { FactoryOptions, ProductionPage, StepView } from "@/lib/db/factory-page";
import { usd, type Estimate } from "@/lib/domain/factory/budget";
import { STEP_HELP, isPaidStep } from "@/lib/domain/factory/steps";
import type { StartOutcome } from "@/lib/factory/engine";
import { STEP_TONE, STEP_WORD } from "./status";
import styles from "./factory.module.css";

type Run = <T>(
  fn: () => Promise<FactoryResult<T>>,
  success?: string | ((v: T) => string | null),
) => void;

/**
 * Section 6: every pipeline step with its status, progress, outputs for review and a "Wait for
 * me" / "Autopilot" switch. Paid steps say so on the button and show their estimate first.
 */
export function PipelineSection({
  video,
  options,
  run,
  notify,
  pending,
}: {
  video: ProductionPage;
  options: FactoryOptions;
  run: Run;
  notify: (m: string, tone?: "error") => void;
  pending: boolean;
}) {
  const [prompt, setPrompt] = useState<{ prompt: string; reason: string } | null>(null);
  const draft = video.status === "draft";
  const missing = !video.idea.trim()
    ? "Write the idea first."
    : !video.style
      ? "Pick a style."
      : video.useAvatar && !video.avatarId
        ? "Pick an avatar, or switch the UGC avatar off."
        : !video.voiceKey
          ? "Pick a voice."
          : !video.musicKey
            ? "Pick a music track."
            : null;

  const onOutcome = (o: StartOutcome | null): string | null => {
    if (!o) return null;
    if (o.kind === "manual") {
      setPrompt({ prompt: o.prompt, reason: o.reason });
      return null;
    }
    if (o.kind === "error") return o.message;
    return o.kind === "session" ? "Started a Claude session." : null;
  };

  return (
    <section id="render" className={styles.section} aria-labelledby="render-h">
      <div className={styles.sectionHead}>
        <h2 id="render-h">6. Visuals and render</h2>
        <div className={styles.grow} />
        {draft ? (
          <Button
            variant="primary"
            disabled={Boolean(missing) || pending}
            onClick={() => {
              run(
                () => startVideo(video.id),
                (o) =>
                  o.kind === "fake"
                    ? "Started. The Sandbox's fake runner posted the first step."
                    : onOutcome(o),
              );
            }}
          >
            <Play aria-hidden="true" />
            Start production
          </Button>
        ) : null}
      </div>
      {draft ? (
        <p className={styles.help}>
          {missing ??
            "Everything is chosen. Starting is free; only the avatar clips cost money, and they are quoted first."}
          {options.sandbox ? " In the Sandbox a fake runner plays the session." : ""}
        </p>
      ) : null}
      {!options.routineReady && draft ? (
        <p className={styles.help}>
          The factory routine isn&apos;t set up yet: Start gives you a prompt to paste into a Claude
          Code session.
        </p>
      ) : null}
      {prompt ? <PromptBox prompt={prompt} notify={notify} /> : null}

      <div className={styles.steps}>
        {video.steps.map((s) => (
          <StepRow
            key={s.step}
            video={video}
            s={s}
            run={run}
            pending={pending}
            onOutcome={onOutcome}
          />
        ))}
      </div>

      {video.recipe.length ? (
        <>
          <h3 className={styles.itemTitle} style={{ margin: 0 }}>
            Recipe
          </h3>
          <dl className={styles.recipe} data-testid="recipe">
            {video.recipe.map((r) => (
              <div key={r.label} style={{ display: "contents" }}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      {video.jobs.length ? (
        <>
          <h3 className={styles.itemTitle} style={{ margin: 0 }}>
            Generation log
          </h3>
          <ul className={styles.lines} data-testid="gen-jobs">
            {video.jobs.map((j) => (
              <li key={j.id}>
                Avatar clip <b>{j.slot}</b>, {j.model}: {j.status}, {usd(j.costUsd ?? j.quoteUsd)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function PromptBox({
  prompt,
  notify,
}: {
  prompt: { prompt: string; reason: string };
  notify: (m: string) => void;
}) {
  return (
    <div className={styles.notice} data-testid="manual-prompt">
      <span>{prompt.reason}</span>
      <pre className={styles.prompt}>{prompt.prompt}</pre>
      <div className={styles.row}>
        <Button
          onClick={() => {
            void navigator.clipboard.writeText(prompt.prompt).then(() => {
              notify("Prompt copied.");
            });
          }}
        >
          <Copy aria-hidden="true" />
          Copy prompt
        </Button>
        <span className={styles.meta}>
          It holds a token for this video only, valid for 24 hours.
        </span>
      </div>
    </div>
  );
}

function StepRow({
  video,
  s,
  run,
  pending,
  onOutcome,
}: {
  video: ProductionPage;
  s: StepView;
  run: Run;
  pending: boolean;
  onOutcome: (o: StartOutcome | null) => string | null;
}) {
  const [note, setNote] = useState("");
  const paid = isPaidStep(s.step);
  const quote = paid ? (s.output as { quote?: Estimate }).quote : undefined;
  const scheduled = video.status === "scheduled";

  return (
    <div className={styles.step} data-status={s.status} data-step={s.step}>
      <div className={styles.stepHead}>
        <h3>{s.label}</h3>
        <StatusDot tone={STEP_TONE[s.status] ?? "neutral"}>
          {STEP_WORD[s.status] ?? s.status}
        </StatusDot>
        {paid ? (
          <span className={styles.paid}>Paid</span>
        ) : (
          <span className={styles.free}>Free</span>
        )}
        <div className={styles.grow} />
        {s.sessionUrl ? (
          <a href={s.sessionUrl} target="_blank" rel="noreferrer" className={styles.money}>
            <ExternalLink aria-hidden="true" width={14} height={14} />
            Watch session
          </a>
        ) : null}
        <div className={styles.segmented} role="group" aria-label={`${s.label}: approval`}>
          <button
            type="button"
            aria-pressed={s.mode === "wait"}
            disabled={pending || scheduled}
            onClick={() => {
              run(() => setStepMode(video.id, s.step, "wait"));
            }}
          >
            Wait for me
          </button>
          <button
            type="button"
            aria-pressed={s.mode === "auto"}
            disabled={pending || scheduled}
            onClick={() => {
              run(() => setStepMode(video.id, s.step, "auto"));
            }}
            title={
              paid
                ? "Autopilot approves this paid step only while the quote fits under the caps."
                : undefined
            }
          >
            Autopilot
          </button>
        </div>
      </div>
      <p className={styles.help}>{STEP_HELP[s.step]}</p>
      {s.status === "running" ? (
        <div
          className={styles.progress}
          role="progressbar"
          aria-valuenow={s.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${s.label} progress`}
        >
          <span style={{ width: `${s.progress}%` }} />
        </div>
      ) : null}
      {s.message ? (
        <p className={s.status === "failed" ? styles.error : styles.help}>{s.message}</p>
      ) : null}
      <StepOutput s={s} />
      {s.status === "waiting" || s.status === "failed" ? (
        <div className={styles.row}>
          {s.status === "waiting" ? (
            <Button
              variant={paid ? "secondary" : "primary"}
              disabled={pending}
              onClick={() => {
                run(() => approve(video.id, s.step), onOutcome);
              }}
              data-paid={paid}
            >
              <Check aria-hidden="true" />
              {paid && quote ? `Approve and pay up to ${usd(quote.totalUsd)}` : "Approve"}
            </Button>
          ) : null}
          <input
            className={styles.input}
            style={{ flex: "1 1 200px", width: "auto" }}
            placeholder="What to change (optional)"
            aria-label={`${s.label}: what to change`}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
          <Button
            disabled={pending}
            onClick={() => {
              run(() => redo(video.id, s.step, note), onOutcome);
            }}
          >
            <RotateCcw aria-hidden="true" />
            Redo{s.step === "render" && video.useAvatar ? " (keeps avatar clips)" : ""}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StepOutput({ s }: { s: StepView }) {
  const out = (s.output ?? {}) as Record<string, unknown>;
  if (s.status === "pending" || s.status === "running") return null;
  switch (s.step) {
    case "idea":
      return typeof out.brief === "string" ? (
        <div className={styles.help}>
          <p style={{ margin: 0 }}>{out.brief}</p>
          {typeof out.hook === "string" ? <p style={{ margin: 0 }}>Hook: “{out.hook}”</p> : null}
        </div>
      ) : null;
    case "script": {
      const lines = Array.isArray(out.lines)
        ? (out.lines as { id: string; text: string; slot?: string | null }[])
        : [];
      return (
        <ol className={styles.lines} data-testid="script-lines">
          {lines.map((l) => (
            <li key={l.id}>
              {l.text}
              {l.slot ? <span className={styles.slotTag}>avatar: {l.slot}</span> : null}
            </li>
          ))}
        </ol>
      );
    }
    case "style":
    case "visuals": {
      const items = (
        Array.isArray(out.frames) ? out.frames : Array.isArray(out.stills) ? out.stills : []
      ) as {
        url: string;
        caption: string;
      }[];
      return (
        <div className={styles.stills} data-testid={`${s.step}-stills`}>
          {items.map((f, i) => (
            <figure key={`${f.url}-${i}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.frame} src={f.url} alt={f.caption} loading="lazy" />
              <figcaption>{f.caption}</figcaption>
            </figure>
          ))}
        </div>
      );
    }
    case "face_quote": {
      const quote = out.quote as Estimate | undefined;
      const slots = (Array.isArray(out.slots) ? out.slots : []) as {
        slot: string;
        seconds: number;
      }[];
      if (!quote) return null;
      return (
        <div className={styles.quote} data-testid="face-quote">
          <span>Model</span>
          <b>{quote.model}</b>
          <span>Slots</span>
          <span>{slots.map((x) => `${x.slot} ${x.seconds} s`).join(", ")}</span>
          <span>Clips</span>
          <span>{usd(quote.baseUsd)}</span>
          <span>Re-roll allowance</span>
          <span>{usd(quote.rerollUsd)}</span>
          <span>Estimate</span>
          <b>{usd(quote.totalUsd)}</b>
        </div>
      );
    }
    case "render":
      return typeof out.duration_s === "number" ? (
        <p className={styles.help}>
          Rendered {out.duration_s} s
          {typeof out.face_share === "number"
            ? `, avatar on screen ${Math.round(out.face_share * 100)}% of the time`
            : ""}
          . Remotion renders are free.
        </p>
      ) : null;
  }
}
