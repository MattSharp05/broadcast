"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { SUGGESTED_GENRES, genreLabel } from "@/lib/domain/genres";
import { REFERENCES_MAX, RULES_MAX, mixCounts, type RoutineConfig } from "@/lib/domain/routines";
import type { FormOptions } from "@/lib/routines/page";
import styles from "./routines.module.css";

/**
 * The reusable part of a routine (also a template's whole content): references, genre mix,
 * styles, voices, music, avatar and the planner's rules.
 */
export function ConfigEditor({
  value,
  onChange,
  options,
  slotCount,
  disabled,
}: {
  value: RoutineConfig;
  onChange: (next: RoutineConfig) => void;
  options: Pick<FormOptions, "styles" | "voices" | "music" | "avatars">;
  /** How many videos the routine makes, to show the mix as counts. */
  slotCount?: number;
  disabled?: boolean;
}) {
  const set = (patch: Partial<RoutineConfig>) => {
    onChange({ ...value, ...patch });
  };
  const toggle = (list: string[], key: string) =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  const counts = slotCount ? mixCounts(value.genreMix, slotCount) : null;
  const unusedGenres = SUGGESTED_GENRES.filter(
    (g) => !value.genreMix.some((m) => m.genre === g.key),
  );

  return (
    <>
      <section className={styles.section} aria-labelledby="mix-h">
        <div className={styles.sectionHead}>
          <h2 id="mix-h">Genre mix</h2>
        </div>
        <p className={styles.help}>
          The share of each kind of video. The planner spreads them out so the same genre
          doesn&apos;t post twice in a row. Leave it empty to let the planner choose.
        </p>
        {value.genreMix.map((g, i) => (
          <div key={g.genre} className={styles.mixRow}>
            <span className={styles.preview}>
              <b>{genreLabel(g.genre)}</b>
              {counts ? ` (${counts.get(g.genre) ?? 0} of ${slotCount} videos)` : ""}
            </span>
            <input
              className={styles.input}
              type="number"
              min={1}
              max={100}
              aria-label={`Share of ${genreLabel(g.genre)}`}
              value={g.weight}
              disabled={disabled}
              onChange={(e) => {
                const mix = [...value.genreMix];
                mix[i] = { genre: g.genre, weight: Math.max(1, Number(e.target.value) || 1) };
                set({ genreMix: mix });
              }}
            />
            <Button
              variant="ghost"
              aria-label={`Remove ${genreLabel(g.genre)}`}
              disabled={disabled}
              onClick={() => {
                set({ genreMix: value.genreMix.filter((m) => m.genre !== g.genre) });
              }}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        {unusedGenres.length ? (
          <label className={styles.field} style={{ maxWidth: 280 }}>
            Add a genre
            <select
              className={styles.select}
              value=""
              disabled={disabled}
              onChange={(e) => {
                if (e.target.value)
                  set({ genreMix: [...value.genreMix, { genre: e.target.value, weight: 1 }] });
              }}
            >
              <option value="">Pick one…</option>
              {unusedGenres.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}: {g.help}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="look-h">
        <div className={styles.sectionHead}>
          <h2 id="look-h">Styles, voices and music</h2>
        </div>
        <p className={styles.help}>
          Tick the ones the planner may use. With more than one voice ticked, the planner rotates
          them, so the Posts tab can compare how each voice does. Nothing ticked: any of them.
        </p>
        <Checks
          label="Styles"
          options={options.styles}
          selected={value.styles}
          disabled={disabled}
          onToggle={(k) => {
            set({ styles: toggle(value.styles, k) });
          }}
        />
        <Checks
          label="Voices"
          options={options.voices}
          selected={value.voices}
          disabled={disabled}
          onToggle={(k) => {
            set({ voices: toggle(value.voices, k) });
          }}
        />
        <Checks
          label="Music"
          options={options.music}
          selected={value.music}
          disabled={disabled}
          onToggle={(k) => {
            set({ music: toggle(value.music, k) });
          }}
        />
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={value.useAvatar}
            disabled={Boolean(disabled) || !options.avatars.length}
            onChange={(e) => {
              set({
                useAvatar: e.target.checked,
                avatarId: e.target.checked ? (options.avatars[0]?.key ?? null) : null,
              });
            }}
          />
          <span>
            UGC avatar in every video
            <small>
              {options.avatars.length
                ? "Paid face clips, approved on autopilot only under the caps (Content Factory settings)."
                : "No avatar has a saved version yet."}
            </small>
          </span>
        </label>
        {value.useAvatar ? (
          <label className={styles.field} style={{ maxWidth: 280 }}>
            Avatar
            <select
              className={styles.select}
              value={value.avatarId ?? ""}
              disabled={disabled}
              onChange={(e) => {
                set({ avatarId: e.target.value || null });
              }}
            >
              {options.avatars.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="refs-h">
        <div className={styles.sectionHead}>
          <h2 id="refs-h">Reference videos</h2>
        </div>
        <p className={styles.help}>
          Links to videos to learn from (pacing, hooks, look), with a note on what to take from
          each. Every planner and video session gets them.
        </p>
        {value.references.map((r, i) => (
          <div key={i} className={styles.refRow}>
            <input
              className={styles.input}
              type="url"
              placeholder="https://www.instagram.com/reel/…"
              aria-label={`Reference ${i + 1} link`}
              value={r.url}
              disabled={disabled}
              onChange={(e) => {
                const refs = [...value.references];
                refs[i] = { ...r, url: e.target.value };
                set({ references: refs });
              }}
            />
            <input
              className={styles.input}
              placeholder="What to take from it"
              aria-label={`Reference ${i + 1} note`}
              value={r.note}
              disabled={disabled}
              onChange={(e) => {
                const refs = [...value.references];
                refs[i] = { ...r, note: e.target.value };
                set({ references: refs });
              }}
            />
            <Button
              variant="ghost"
              aria-label={`Remove reference ${i + 1}`}
              disabled={disabled}
              onClick={() => {
                set({ references: value.references.filter((_, j) => j !== i) });
              }}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        {value.references.length < REFERENCES_MAX ? (
          <div>
            <Button
              disabled={disabled}
              onClick={() => {
                set({ references: [...value.references, { url: "", note: "" }] });
              }}
            >
              <Plus aria-hidden="true" />
              Add a reference
            </Button>
          </div>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="rules-h">
        <div className={styles.sectionHead}>
          <h2 id="rules-h">Rules for the planner</h2>
        </div>
        <p className={styles.help}>
          In your own words: topics, tone, what to test. For example: &quot;Trip app campaign. Half
          the videos end with the app on screen. Test three hook styles: question, bold claim,
          number.&quot;
        </p>
        <textarea
          className={styles.textarea}
          aria-label="Rules for the planner"
          maxLength={RULES_MAX}
          value={value.rules}
          disabled={disabled}
          onChange={(e) => {
            set({ rules: e.target.value });
          }}
        />
      </section>
    </>
  );
}

function Checks({
  label,
  options,
  selected,
  onToggle,
  disabled,
}: {
  label: string;
  options: { key: string; label: string; help?: string }[];
  selected: string[];
  onToggle: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ padding: 0, marginBottom: 6 }}>
        {label}
        <span className={styles.muted}>
          {selected.length ? ` (${selected.length} ticked)` : " (any)"}
        </span>
      </legend>
      <div className={styles.checks}>
        {options.map((o) => (
          <label key={o.key} className={styles.check}>
            <input
              type="checkbox"
              checked={selected.includes(o.key)}
              disabled={disabled}
              onChange={() => {
                onToggle(o.key);
              }}
            />
            <span>
              {o.label}
              {o.help ? <small>{o.help}</small> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
