"use client";

import { Check, Sparkles } from "lucide-react";
import { useState } from "react";
import {
  pickStyle,
  pickStyleBut,
  type FactoryResult,
  type VideoPatch,
} from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import { TextArea } from "@/components/TextArea";
import type { ProductionPage } from "@/lib/db/factory-page";
import { STYLE_PACKS, stylePack } from "@/lib/domain/factory/styles";
import styles from "./factory.module.css";

interface ComparedFrame {
  url: string;
  caption: string;
  style: string;
  recommended?: boolean;
}

/**
 * Section 2: the style. Pick one of the packs, or compare styles (the default for a new video):
 * the style step then shows the same beat in 2–3 styles side by side, one recommended, and
 * "Use this style" picks it (or "Use this, but …" redoes that style's frame with a note).
 */
export function StyleSection({
  video,
  draft,
  save,
  run,
  pending,
}: {
  video: ProductionPage;
  draft: boolean;
  save: (patch: VideoPatch) => void;
  run: <T>(
    fn: () => Promise<FactoryResult<T>>,
    success?: string | ((v: T) => string | null),
  ) => void;
  pending: boolean;
}) {
  const step = video.steps.find((s) => s.step === "style");
  const frames = comparedFrames(step?.output);
  const comparing = video.compareStyles && step?.status === "waiting" && frames.length > 1;
  const locked = !draft || pending;
  return (
    <section id="style" className={styles.section} aria-labelledby="style-h">
      <div className={styles.sectionHead}>
        <h2 id="style-h">2. Style</h2>
        <span className={styles.meta}>The animated-video style packs</span>
      </div>

      {comparing ? (
        <CompareFrames video={video} frames={frames} run={run} pending={pending} />
      ) : null}

      {draft ? (
        <label className={styles.compareToggle}>
          <input
            type="checkbox"
            checked={video.compareStyles}
            disabled={pending}
            onChange={(e) => {
              save({ compareStyles: e.target.checked });
            }}
          />
          <span>
            Compare styles: the style step shows the same beat in 2–3 styles and you pick one.
          </span>
        </label>
      ) : null}

      {draft && video.compareStyles ? (
        <fieldset className={styles.candidates} data-testid="style-candidates">
          <legend className={styles.help}>
            Tick up to three to compare, or leave them for Claude to pick from the brief.
          </legend>
          {STYLE_PACKS.map((s) => {
            const ticked = video.styleCandidates.includes(s.key);
            return (
              <label key={s.key} className={styles.candidate}>
                <input
                  type="checkbox"
                  checked={ticked}
                  disabled={pending || (!ticked && video.styleCandidates.length >= 3)}
                  onChange={() => {
                    save({
                      styleCandidates: ticked
                        ? video.styleCandidates.filter((k) => k !== s.key)
                        : [...video.styleCandidates, s.key],
                    });
                  }}
                />
                {s.label}
              </label>
            );
          })}
        </fieldset>
      ) : null}

      {!draft && video.compareStyles && !comparing ? (
        <p className={styles.help}>The style step will show the styles to pick from.</p>
      ) : null}

      <div className={styles.styles} role="radiogroup" aria-labelledby="style-h">
        {STYLE_PACKS.map((s) => {
          const selected = video.style === s.key;
          return (
            <label
              key={s.key}
              className={styles.card}
              data-selected={selected}
              aria-disabled={locked && !selected}
              data-style={s.key}
            >
              <input
                type="radio"
                name="style"
                value={s.key}
                checked={selected}
                disabled={locked}
                onChange={() => {
                  save({ style: s.key });
                }}
              />
              {s.example ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={styles.frame}
                  src={s.example}
                  alt={`Example frame: ${s.exampleFrom ?? s.label}`}
                  loading="lazy"
                />
              ) : (
                <span className={`${styles.frame} ${styles.noFrame}`}>
                  No past project in this style yet
                </span>
              )}
              <strong>{s.label}</strong>
              <span>{s.suits}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function comparedFrames(output: unknown): ComparedFrame[] {
  const frames = (output as { frames?: unknown } | null)?.frames;
  if (!Array.isArray(frames)) return [];
  return frames.flatMap((f: unknown) => {
    const o = (f ?? {}) as Record<string, unknown>;
    return typeof o.url === "string" && typeof o.style === "string"
      ? [
          {
            url: o.url,
            caption: typeof o.caption === "string" ? o.caption : "",
            style: o.style,
            recommended: o.recommended === true,
          },
        ]
      : [];
  });
}

function CompareFrames({
  video,
  frames,
  run,
  pending,
}: {
  video: ProductionPage;
  frames: ComparedFrame[];
  run: <T>(
    fn: () => Promise<FactoryResult<T>>,
    success?: string | ((v: T) => string | null),
  ) => void;
  pending: boolean;
}) {
  const [but, setBut] = useState<{ style: string; note: string } | null>(null);
  return (
    <div className={styles.compare} data-testid="style-compare">
      {frames.map((f) => {
        const label = stylePack(f.style)?.label ?? f.style;
        return (
          <figure key={f.style} className={styles.compareFrame} data-style-frame={f.style}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.url} alt={`The hook beat in ${label}`} />
            <figcaption>
              <strong>{label}</strong>
              {f.recommended ? (
                <span className={styles.recommended} data-testid="recommended">
                  <Sparkles aria-hidden="true" />
                  Recommended
                </span>
              ) : null}
              <span className={styles.help}>{f.caption}</span>
            </figcaption>
            <div className={styles.row}>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => {
                  run(
                    () => pickStyle(video.id, f.style),
                    `${label} it is. The visuals step has started.`,
                  );
                }}
              >
                <Check aria-hidden="true" />
                Use this style
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setBut({ style: f.style, note: "" });
                }}
              >
                Use this, but …
              </Button>
            </div>
            {but?.style === f.style ? (
              <div className={styles.row}>
                <TextArea
                  className={styles.textarea}
                  value={but.note}
                  aria-label={`What to change in ${label}`}
                  placeholder="warmer, less contrast…"
                  rows={2}
                  onChange={(e) => {
                    setBut({ style: f.style, note: e.target.value });
                  }}
                />
                <Button
                  disabled={pending || !but.note.trim()}
                  onClick={() => {
                    run(
                      () => pickStyleBut(video.id, f.style, but.note),
                      `Redoing the ${label} frame with your note.`,
                    );
                    setBut(null);
                  }}
                >
                  Redo in {label}
                </Button>
              </div>
            ) : null}
          </figure>
        );
      })}
    </div>
  );
}
