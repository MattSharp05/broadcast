"use client";

import { useState } from "react";
import { decideHero, type FactoryResult } from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import { StatusDot } from "@/components/StatusDot";
import type { FactoryOptions, HeroView, ProductionPage } from "@/lib/db/factory-page";
import { usd } from "@/lib/domain/factory/budget";
import { CHOICE_LABELS, type HeroChoice } from "@/lib/domain/factory/mesh";
import styles from "./factory.module.css";

type Run = <T>(
  fn: () => Promise<FactoryResult<T>>,
  success?: string | ((v: T) => string | null),
) => void;

/**
 * Hero 3D assets (BC-30): the session's proposal (three.js stills, why generating may look
 * better, the input, the suggested model) and Matthew's choice: keep three.js, redo it with
 * notes, or generate with a model (paid, priced first). After generating, the two are compared
 * and he picks one. His reason is always asked for: the video-editor skill learns from it.
 */
export function HeroSection({
  video,
  options,
  run,
  pending,
}: {
  video: ProductionPage;
  options: FactoryOptions;
  run: Run;
  pending: boolean;
}) {
  if (video.heroes.length === 0) return null;
  return (
    <section id="hero" className={styles.section} aria-labelledby="hero-h">
      <div className={styles.sectionHead}>
        <h2 id="hero-h">Hero 3D assets</h2>
        <span className={styles.meta}>Generating is paid; autopilot never decides these.</span>
      </div>
      {video.heroes.map((h) => (
        <HeroCard key={h.id} video={video} hero={h} options={options} run={run} pending={pending} />
      ))}
    </section>
  );
}

function Stills({ items, label }: { items: { label: string; url: string }[]; label: string }) {
  if (!items.length) return null;
  return (
    <div className={styles.stills} aria-label={label} role="group">
      {items.map((s, i) => (
        <figure key={`${s.url}-${i}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.frame}
            style={{ aspectRatio: "auto" }}
            src={s.url}
            alt={`${label}: ${s.label}`}
          />
          <figcaption>{s.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function HeroCard({
  video,
  hero,
  options,
  run,
  pending,
}: {
  video: ProductionPage;
  hero: HeroView;
  options: FactoryOptions;
  run: Run;
  pending: boolean;
}) {
  const pickable = options.meshModels.filter(
    (m) => m.pickable && (hero.input.mode !== "text" || m.text),
  );
  const [model, setModel] = useState(
    pickable.find((m) => m.key === hero.suggestedModel)?.key ??
      pickable.find((m) => m.priceUsd > 0)?.key ??
      pickable[0]?.key ??
      "",
  );
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const chosen = options.meshModels.find((m) => m.key === model);
  const comparison = hero.stage === "comparison";
  const waiting = hero.status === "pending";
  const decide = (choice: HeroChoice) => {
    run(
      () =>
        decideHero(video.id, hero.id, {
          choice,
          model: choice === "generate" ? model : null,
          notes,
          reason,
        }),
      (c) => `${CHOICE_LABELS[c]}: saved. The session picks it up.`,
    );
  };
  return (
    <div
      className={styles.step}
      data-status={waiting ? "waiting" : "approved"}
      data-hero={hero.proposalId}
    >
      <div className={styles.stepHead}>
        <h3>
          {hero.object}
          {hero.scene ? <span className={styles.meta}> in {hero.scene}</span> : null}
        </h3>
        <StatusDot tone={waiting ? "warn" : "good"}>
          {waiting ? (comparison ? "Compare and pick" : "Waiting for you") : "Decided"}
        </StatusDot>
      </div>
      {hero.score ? (
        <p className={styles.meta} data-testid="hero-score">
          Score: {hero.score}
        </p>
      ) : null}
      {hero.reason ? <p className={styles.help}>{hero.reason}</p> : null}
      {hero.whyGenerate ? (
        <p className={styles.help}>Why generating may look better: {hero.whyGenerate}</p>
      ) : null}
      {hero.onScreen ? <p className={styles.help}>On screen: {hero.onScreen}</p> : null}
      <p className={styles.help}>
        Input:{" "}
        {hero.input.mode === "text"
          ? `text prompt “${hero.input.prompt ?? ""}”`
          : "a reference image"}
        {hero.input.mode !== "text" && hero.input.prompt ? ` and “${hero.input.prompt}”` : ""}.
        Suggested: {hero.suggestedModel ?? "none"} (~{usd(hero.estimateUsd)}).
      </p>
      <Stills items={hero.stills} label="three.js version" />
      {comparison ? <Stills items={hero.comparisonStills} label="Generated version" /> : null}

      {waiting ? (
        <>
          <div
            className={styles.list}
            role="radiogroup"
            aria-label={`3D model for ${hero.object}`}
            style={{ maxHeight: 240 }}
          >
            {options.meshModels.map((m) => (
              <label
                key={m.key}
                className={styles.item}
                data-selected={model === m.key}
                aria-disabled={!pickable.includes(m)}
              >
                <input
                  type="radio"
                  name={`mesh-${hero.id}`}
                  checked={model === m.key}
                  disabled={!pickable.includes(m) || pending}
                  onChange={() => {
                    setModel(m.key);
                  }}
                />
                <span className={styles.itemBody}>
                  <span className={styles.itemTitle}>{m.label}</span>
                  <span className={styles.meta}>
                    {m.priceUsd === 0 ? "Free" : usd(m.priceUsd)}, {m.status}
                    {!pickable.includes(m)
                      ? hero.input.mode === "text" && !m.text
                        ? ", no text-to-3D"
                        : ", not enabled in Settings"
                      : ""}
                  </span>
                  <span className={styles.meta}>{m.licence}</span>
                </span>
                {m.priceUsd === 0 ? (
                  <span className={styles.free}>Free</span>
                ) : (
                  <span className={styles.paid}>Paid</span>
                )}
              </label>
            ))}
          </div>
          <label className={styles.field}>
            Why (required: the skill learns from it)
            <input
              className={styles.input}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
              placeholder="The three.js sphere looks flat close up"
            />
          </label>
          <label className={styles.field}>
            Notes for a redo (optional)
            <input
              className={styles.input}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
            />
          </label>
          <div className={styles.row}>
            {comparison ? (
              <>
                <Button
                  variant="primary"
                  disabled={pending || !reason.trim()}
                  onClick={() => {
                    decide("use_generated");
                  }}
                >
                  Use generated
                </Button>
                <Button
                  disabled={pending || !reason.trim()}
                  onClick={() => {
                    decide("keep_threejs_after_compare");
                  }}
                >
                  Keep three.js
                </Button>
              </>
            ) : (
              <Button
                disabled={pending || !reason.trim()}
                onClick={() => {
                  decide("keep_threejs");
                }}
              >
                Keep three.js
              </Button>
            )}
            <Button
              disabled={pending || !reason.trim()}
              onClick={() => {
                decide("redo_threejs");
              }}
            >
              Redo three.js with notes
            </Button>
            <Button
              variant={comparison ? "secondary" : "primary"}
              disabled={pending || !reason.trim() || !chosen}
              onClick={() => {
                decide("generate");
              }}
              data-paid={Boolean(chosen && chosen.priceUsd > 0)}
            >
              {comparison ? "Generate again" : "Generate"} with {chosen?.label ?? "…"}
              {chosen && chosen.priceUsd > 0 ? `, paid ${usd(chosen.priceUsd)}` : ", free"}
            </Button>
          </div>
        </>
      ) : null}

      {hero.jobs.length ? (
        <ul className={styles.lines}>
          {hero.jobs.map((j, i) => (
            <li key={i}>
              {j.model}: {j.status}, {usd(j.costUsd ?? j.quoteUsd)}
            </li>
          ))}
        </ul>
      ) : null}
      {hero.decisions.length ? (
        <ul className={styles.lines} data-testid="hero-decisions">
          {hero.decisions.map((d, i) => (
            <li key={i}>
              {d.stage === "comparison" ? "After comparing: " : ""}
              {(CHOICE_LABELS as Record<string, string | undefined>)[d.choice] ?? d.choice}
              {d.model ? ` with ${d.model}` : ""}
              {d.budgetUsd ? ` (up to ${usd(d.budgetUsd)})` : ""}: “{d.reason}”
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
