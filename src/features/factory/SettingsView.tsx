"use client";

import { ArrowLeft, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  removeKey,
  saveCaps,
  saveDefaultModes,
  saveKey,
  saveModels,
  testKey,
} from "@/app/(app)/factory/settings/actions";
import { Button, ButtonLink } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { StatusDot } from "@/components/StatusDot";
import { usd } from "@/lib/domain/factory/budget";
import {
  ALL_STEPS,
  STEP_LABELS,
  isPaidStep,
  type StepMode,
  type StepModes,
} from "@/lib/domain/factory/steps";
import { useFactoryAction } from "./ProductionView";
import styles from "./factory.module.css";

interface ProviderRow {
  key: string;
  label: string;
  envName: string;
  adapter: boolean;
  saved: {
    last4: string;
    testedAt: string | null;
    testOk: boolean | null;
    testMessage: string | null;
  } | null;
  spentMonthUsd: number;
  spentTotalUsd: number;
}

interface ModelRow {
  key: string;
  label: string;
  provider: string;
  pricePerS: number;
  maxS: number;
  status: string;
  notes: string;
  free: boolean;
  selectable: boolean;
  hasKey: boolean;
}

export function SettingsView(props: {
  sandbox: boolean;
  providers: ProviderRow[];
  models: ModelRow[];
  enabled: string[];
  defaultModel: string;
  fallbackModel: string | null;
  caps: { perVideoUsd: number; monthlyUsd: number };
  modes: StepModes;
  monthUsd: number;
  routineReady: boolean;
}) {
  const { pending, run, toastEl } = useFactoryAction();
  const ok = (m: string) => m;
  return (
    <>
      <PageHeader
        title="Content Factory settings"
        stats={[
          {
            value: `${usd(props.monthUsd)} of ${usd(props.caps.monthlyUsd)}`,
            label: "Spent this month",
            labelFirst: true,
          },
        ]}
        actions={
          <ButtonLink href="/factory" variant="ghost">
            <ArrowLeft aria-hidden="true" />
            Content Factory
          </ButtonLink>
        }
      />
      <div className={styles.page}>
        <div className={styles.sections} style={{ maxWidth: 860 }}>
          <section className={styles.section} aria-labelledby="keys-h">
            <div className={styles.sectionHead}>
              <h2 id="keys-h">Generation keys</h2>
              <ShieldCheck aria-hidden="true" width={16} height={16} />
            </div>
            <p className={styles.help}>
              Encrypted on the server with TOKEN_ENC_KEY. After saving, only the last 4 characters
              are shown. Keys are never sent to the browser or to Claude sessions: sessions call
              Broadcast&apos;s generation proxy, which uses the key.
              {props.sandbox
                ? " In the Sandbox, the fake provider is used and no key is ever called."
                : ""}
            </p>
            <div className={styles.steps} data-testid="gen-keys">
              {props.providers.map((p) => (
                <KeyRow key={p.key} p={p} pending={pending} run={run} ok={ok} />
              ))}
            </div>
          </section>

          <ModelsSection {...props} pending={pending} run={run} ok={ok} />

          <CapsSection caps={props.caps} pending={pending} run={run} ok={ok} />

          <ModesSection modes={props.modes} pending={pending} run={run} ok={ok} />

          <section className={styles.section} aria-labelledby="routine-h">
            <div className={styles.sectionHead}>
              <h2 id="routine-h">Claude sessions</h2>
              <StatusDot tone={props.routineReady ? "good" : "warn"}>
                {props.routineReady ? "Routine set up" : "Not set up"}
              </StatusDot>
            </div>
            <p className={styles.help}>
              Each step runs in a Claude Code cloud session on video-editor, started through a
              routine&apos;s API trigger. Set FACTORY_ROUTINE_ID and FACTORY_ROUTINE_TOKEN in
              Vercel. Until then, Start gives you a prompt to paste into a session.
            </p>
          </section>
        </div>
      </div>
      {toastEl}
    </>
  );
}

type Run = ReturnType<typeof useFactoryAction>["run"];

function KeyRow({
  p,
  pending,
  run,
  ok,
}: {
  p: ProviderRow;
  pending: boolean;
  run: Run;
  ok: (m: string) => string;
}) {
  const [value, setValue] = useState("");
  return (
    <div className={styles.step} data-provider={p.key}>
      <div className={styles.stepHead}>
        <h3>{p.label}</h3>
        {p.saved ? (
          <StatusDot tone={p.saved.testOk === false ? "bad" : p.saved.testOk ? "good" : "neutral"}>
            {p.saved.testOk === false ? "Test failed" : p.saved.testOk ? "Tested" : "Saved"}
          </StatusDot>
        ) : (
          <StatusDot tone="neutral">No key</StatusDot>
        )}
        <div className={styles.grow} />
        <span className={styles.meta}>
          Spent {usd(p.spentMonthUsd)} this month, {usd(p.spentTotalUsd)} in all
        </span>
      </div>
      {p.saved ? (
        <div className={styles.row}>
          <span className={styles.money}>
            <KeyRound aria-hidden="true" width={14} height={14} />
            <span data-testid={`masked-${p.key}`}>•••• {p.saved.last4}</span>
          </span>
          {p.saved.testMessage ? (
            <span className={p.saved.testOk ? styles.free : styles.error}>
              {p.saved.testMessage}
            </span>
          ) : null}
          <div className={styles.grow} />
          <Button
            disabled={pending || !p.adapter}
            onClick={() => {
              run(() => testKey(p.key), ok);
            }}
            title={p.adapter ? "A free call that checks the key" : "No adapter yet"}
          >
            Test key
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              run(() => removeKey(p.key), ok);
            }}
          >
            <Trash2 aria-hidden="true" />
            Remove
          </Button>
        </div>
      ) : null}
      <div className={styles.row}>
        <input
          className={styles.input}
          style={{ flex: "1 1 260px", width: "auto" }}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={`${p.envName}${p.saved ? " (replace)" : ""}`}
          aria-label={`${p.label} key`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
        <Button
          disabled={pending || value.trim().length < 8}
          onClick={() => {
            run(() => saveKey(p.key, value), ok);
            setValue("");
          }}
        >
          Save key
        </Button>
      </div>
      {!p.adapter ? (
        <p className={styles.help}>
          Broadcast has no adapter for this provider yet; the key is kept for when it does.
        </p>
      ) : null}
    </div>
  );
}

function ModelsSection(props: {
  models: ModelRow[];
  enabled: string[];
  defaultModel: string;
  fallbackModel: string | null;
  pending: boolean;
  run: Run;
  ok: (m: string) => string;
}) {
  const [enabled, setEnabled] = useState(new Set(props.enabled));
  const [def, setDef] = useState(props.defaultModel);
  const [fb, setFb] = useState(props.fallbackModel ?? "");
  const on = props.models.filter((m) => enabled.has(m.key) || m.free);
  return (
    <section className={styles.section} aria-labelledby="models-h">
      <div className={styles.sectionHead}>
        <h2 id="models-h">Face models</h2>
      </div>
      <p className={styles.help}>
        From video-editor&apos;s registry (face_models.json). Enable models whose provider has a
        key. Planned models are listed but can&apos;t be picked. An avatar can set its own default,
        and a video can override both.
      </p>
      <div className={styles.list} style={{ maxHeight: "none" }} data-testid="settings-models">
        {props.models.map((m) => {
          const can = m.selectable && m.hasKey && !m.free;
          return (
            <label
              key={m.key}
              className={styles.item}
              aria-disabled={!can && !m.free}
              data-model={m.key}
            >
              <input
                type="checkbox"
                checked={m.free || enabled.has(m.key)}
                disabled={!can || props.pending}
                onChange={(e) => {
                  const next = new Set(enabled);
                  if (e.target.checked) next.add(m.key);
                  else next.delete(m.key);
                  setEnabled(next);
                }}
              />
              <span className={styles.itemBody}>
                <span className={styles.itemTitle}>{m.label}</span>
                <span className={styles.meta}>
                  {m.free ? "Free" : `${usd(m.pricePerS)}/s`}, up to {m.maxS} s, {m.status}
                  {!m.selectable
                    ? " (no adapter yet)"
                    : !m.hasKey
                      ? ` (needs a ${m.provider} key)`
                      : ""}
                </span>
                {m.notes ? <span className={styles.meta}>{m.notes}</span> : null}
              </span>
              {m.free ? (
                <span className={styles.free}>Free</span>
              ) : (
                <span className={styles.paid}>Paid</span>
              )}
            </label>
          );
        })}
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          Default model
          <select
            className={styles.select}
            value={def}
            onChange={(e) => {
              setDef(e.target.value);
            }}
            aria-label="Default model"
          >
            {on.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Fallback model
          <select
            className={styles.select}
            value={fb}
            onChange={(e) => {
              setFb(e.target.value);
            }}
            aria-label="Fallback model"
          >
            <option value="">None</option>
            {on.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.row}>
        <Button
          variant="primary"
          disabled={props.pending}
          onClick={() => {
            props.run(
              () =>
                saveModels({ enabled: [...enabled], defaultModel: def, fallbackModel: fb || null }),
              props.ok,
            );
          }}
        >
          Save face models
        </Button>
      </div>
    </section>
  );
}

function CapsSection({
  caps,
  pending,
  run,
  ok,
}: {
  caps: { perVideoUsd: number; monthlyUsd: number };
  pending: boolean;
  run: Run;
  ok: (m: string) => string;
}) {
  const [video, setVideo] = useState(String(caps.perVideoUsd));
  const [month, setMonth] = useState(String(caps.monthlyUsd));
  return (
    <section className={styles.section} aria-labelledby="caps-h">
      <div className={styles.sectionHead}>
        <h2 id="caps-h">Spending caps</h2>
      </div>
      <p className={styles.help}>
        Every paid call checks both before it starts: over a cap, nothing runs (the session gets 402
        budget). An avatar&apos;s own cap per video lowers the per-video cap for its videos.
        Autopilot approves paid steps only under the caps.
      </p>
      <div className={styles.row}>
        <label className={styles.field}>
          Per video ($)
          <input
            className={styles.input}
            type="number"
            min={0}
            step={0.5}
            value={video}
            onChange={(e) => {
              setVideo(e.target.value);
            }}
          />
        </label>
        <label className={styles.field}>
          Per month ($)
          <input
            className={styles.input}
            type="number"
            min={0}
            step={1}
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
            }}
          />
        </label>
      </div>
      <div className={styles.row}>
        <Button
          disabled={pending}
          onClick={() => {
            run(() => saveCaps(video, month), ok);
          }}
        >
          Save caps
        </Button>
      </div>
    </section>
  );
}

function ModesSection({
  modes,
  pending,
  run,
  ok,
}: {
  modes: StepModes;
  pending: boolean;
  run: Run;
  ok: (m: string) => string;
}) {
  const [value, setValue] = useState<StepModes>(modes);
  const set = (step: (typeof ALL_STEPS)[number], mode: StepMode) => {
    setValue({ ...value, [step]: mode });
  };
  return (
    <section className={styles.section} aria-labelledby="modes-h">
      <div className={styles.sectionHead}>
        <h2 id="modes-h">Approval or autopilot</h2>
      </div>
      <p className={styles.help}>
        The default for each step of a new video. Each video can switch any step on its own page.
      </p>
      <div className={styles.steps}>
        {ALL_STEPS.map((step) => {
          const mode = value[step] ?? "wait";
          return (
            <div
              key={step}
              className={styles.step}
              style={{ flexDirection: "row", alignItems: "center" }}
            >
              <span className={styles.itemTitle} style={{ flex: 1 }}>
                {STEP_LABELS[step]}{" "}
                {isPaidStep(step) ? <span className={styles.paid}>Paid</span> : null}
              </span>
              <div
                className={styles.segmented}
                role="group"
                aria-label={`${STEP_LABELS[step]} default`}
              >
                <button
                  type="button"
                  aria-pressed={mode === "wait"}
                  onClick={() => {
                    set(step, "wait");
                  }}
                >
                  Wait for me
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "auto"}
                  onClick={() => {
                    set(step, "auto");
                  }}
                >
                  Autopilot
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.row}>
        <Button
          disabled={pending}
          onClick={() => {
            run(() => saveDefaultModes(value), ok);
          }}
        >
          Save defaults
        </Button>
      </div>
    </section>
  );
}
