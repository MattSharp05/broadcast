"use client";

import { ArrowLeft, Check, Upload, X } from "lucide-react";
import { useState } from "react";
import {
  addUploadedCandidate,
  advanceStudio,
  avatarUpload,
  pickCandidate,
  runStudioStep,
  saveProfile,
  setDisclosure,
} from "@/app/(app)/factory/avatars/actions";
import { Button, ButtonLink } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { StatusDot } from "@/components/StatusDot";
import {
  STUDIO_HELP,
  STUDIO_LABELS,
  STUDIO_STEPS,
  isPaidStudioStep,
  stepPicked,
  type Studio,
  type StudioStep,
} from "@/lib/domain/factory/avatar";
import { usd } from "@/lib/domain/factory/budget";
import { AudioPlayButton } from "./AudioPlayButton";
import { useFactoryAction } from "./ProductionView";
import styles from "./factory.module.css";

interface AvatarData {
  id: string;
  name: string;
  accountId: string | null;
  version: number;
  step: string;
  profile: Record<string, unknown>;
  studio: Studio;
}

type Run = ReturnType<typeof useFactoryAction>["run"];

export function AvatarStudio(props: {
  avatar: AvatarData;
  versions: { version: number; note: string; created_at: string }[];
  accounts: { id: string; handle: string; ai_label_done: boolean; ai_bio_done: boolean }[];
  models: { key: string; label: string }[];
  voices: { key: string; label: string }[];
  estimates: { portrait: number; face_pack: number; screen_test: number };
  sandbox: boolean;
}) {
  const { pending, run, toastEl } = useFactoryAction();
  const a = props.avatar;
  const account = props.accounts.find((x) => x.id === a.accountId);
  const done = a.step === "done";
  return (
    <>
      <PageHeader
        title={`${a.name}${a.version ? ` v${a.version}` : ""}`}
        stats={[
          {
            value: done
              ? "Saved"
              : `In the studio: ${STUDIO_LABELS[a.step as Exclude<StudioStep, "done">]}`,
            label: "",
          },
        ]}
        actions={
          <ButtonLink href="/factory/avatars" variant="ghost">
            <ArrowLeft aria-hidden="true" />
            Avatars
          </ButtonLink>
        }
      />
      <div className={styles.page}>
        <div className={styles.sections}>
          {account ? <Disclosure account={account} run={run} pending={pending} /> : null}
          {!done ? (
            <Flow
              a={a}
              estimates={props.estimates}
              sandbox={props.sandbox}
              run={run}
              pending={pending}
            />
          ) : (
            <section className={styles.section} aria-labelledby="studio-done">
              <div className={styles.sectionHead}>
                <h2 id="studio-done">Studio</h2>
                <StatusDot tone="good">Saved as v{a.version}</StatusDot>
              </div>
              <p className={styles.help}>
                The avatar is ready for videos. Edit the profile below; a new look or voice saves a
                new version.
              </p>
            </section>
          )}
          <ProfileForm {...props} run={run} pending={pending} />
          <section className={styles.section} aria-labelledby="versions-h">
            <div className={styles.sectionHead}>
              <h2 id="versions-h">Versions</h2>
            </div>
            {props.versions.length === 0 ? (
              <p className={styles.help}>No version yet: finish the studio to save v1.</p>
            ) : (
              <ul className={styles.lines} data-testid="avatar-versions">
                {props.versions.map((v) => (
                  <li key={v.version}>
                    v{v.version}: {v.note || "Saved."} (
                    {new Date(v.created_at).toLocaleDateString("en-GB")})
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      {toastEl}
    </>
  );
}

function Disclosure({
  account,
  run,
  pending,
}: {
  account: { id: string; handle: string; ai_label_done: boolean; ai_bio_done: boolean };
  run: Run;
  pending: boolean;
}) {
  const doneAll = account.ai_label_done && account.ai_bio_done;
  return (
    <section className={styles.section} aria-labelledby="disclosure-h">
      <div className={styles.sectionHead}>
        <h2 id="disclosure-h">AI disclosure on @{account.handle}</h2>
        <StatusDot tone={doneAll ? "good" : "warn"}>{doneAll ? "Done" : "To do"}</StatusDot>
      </div>
      <p className={styles.help}>
        Avatar videos are always disclosed: posts from the factory are marked is_ai_generated. The
        account itself should say so too.
      </p>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={account.ai_label_done}
          disabled={pending}
          onChange={(e) => {
            run(() => setDisclosure(account.id, "label", e.target.checked));
          }}
        />
        Instagram&apos;s AI-generated profile label is on
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={account.ai_bio_done}
          disabled={pending}
          onChange={(e) => {
            run(() => setDisclosure(account.id, "bio", e.target.checked));
          }}
        />
        The bio has the “AI creator” line
      </label>
    </section>
  );
}

function Flow({
  a,
  estimates,
  sandbox,
  run,
  pending,
}: {
  a: AvatarData;
  estimates: { portrait: number; face_pack: number; screen_test: number };
  sandbox: boolean;
  run: Run;
  pending: boolean;
}) {
  const step = a.step as Exclude<StudioStep, "done">;
  const s = a.studio;
  const missing = stepPicked(step, s);
  const paid = isPaidStudioStep(step);
  const estimate =
    step === "portrait"
      ? estimates.portrait
      : step === "face_pack"
        ? estimates.face_pack
        : step === "screen_test"
          ? estimates.screen_test
          : 0;
  const candidates = {
    persona: s.personas,
    portrait: s.portraits,
    face_pack: s.face_pack,
    voice: s.voices,
    screen_test: s.screen_tests,
  }[step];
  const generated = (candidates?.length ?? 0) > 0;
  const pick = (value: string) => {
    run(() => pickCandidate(a.id, step, value));
  };

  return (
    <section className={styles.section} aria-labelledby="flow-h" data-studio-step={step}>
      <div className={styles.sectionHead}>
        <h2 id="flow-h">Avatar studio</h2>
      </div>
      <ol
        className={styles.row}
        style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}
        aria-label="Studio steps"
      >
        {STUDIO_STEPS.map((x, i) => (
          <li key={x}>
            <StatusDot
              tone={x === step ? "accent" : STUDIO_STEPS.indexOf(step) > i ? "good" : "neutral"}
            >
              {i + 1}. {STUDIO_LABELS[x]}
            </StatusDot>
          </li>
        ))}
      </ol>
      <div className={styles.step} data-status="waiting">
        <div className={styles.stepHead}>
          <h3>{STUDIO_LABELS[step]}</h3>
          {paid ? (
            <span className={styles.paid}>Paid, about {usd(estimate)}</span>
          ) : (
            <span className={styles.free}>Free</span>
          )}
        </div>
        <p className={styles.help}>{STUDIO_HELP[step]}</p>
        <div className={styles.row}>
          <Button
            disabled={pending}
            onClick={() => {
              run(
                () => runStudioStep(a.id, step),
                (m) => m,
              );
            }}
          >
            {generated
              ? "Generate again"
              : step === "persona"
                ? "Draft 3 personas"
                : step === "voice"
                  ? "Load 3 voices"
                  : "Generate"}
            {paid ? ` (paid, ~${usd(estimate)})` : ""}
          </Button>
          {!sandbox && step !== "voice" ? (
            <span className={styles.meta}>
              Live generation for this step isn&apos;t wired up yet; upload instead.
            </span>
          ) : null}
        </div>

        {step === "persona" && s.personas ? (
          <div className={styles.list} role="radiogroup" aria-label="Personas">
            {s.personas.map((p) => (
              <label key={p.id} className={styles.item} data-selected={s.persona_pick === p.id}>
                <input
                  type="radio"
                  name="persona"
                  checked={s.persona_pick === p.id}
                  onChange={() => {
                    pick(p.id);
                  }}
                  disabled={pending}
                />
                <span className={styles.itemBody}>
                  <span className={styles.itemTitle}>
                    {p.name}, {p.age_range}, from {p.from}
                  </span>
                  <span className={styles.meta}>{p.backstory}</span>
                  <span className={styles.meta}>
                    {p.tone}, {p.energy}. “{p.signature_phrase}”
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : null}

        {step === "portrait" ? (
          <>
            <Grid
              items={s.portraits ?? []}
              selected={s.portrait_pick}
              onPick={(id) => {
                pick(id);
              }}
              pending={pending}
              label="Portraits"
            />
            <UploadButton avatarId={a.id} step="portrait" run={run} pending={pending} />
          </>
        ) : null}

        {step === "face_pack" ? (
          <>
            <div className={styles.stills} data-testid="face-pack">
              {(s.face_pack ?? []).map((c) => (
                <figure key={c.id} data-status={c.status}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={styles.frame} src={c.url} alt={c.label} />
                  <figcaption>
                    {c.label}:{" "}
                    {c.status === "approved"
                      ? "approved"
                      : c.status === "rejected"
                        ? "rejected"
                        : "to review"}
                  </figcaption>
                  <div className={styles.row} style={{ gap: 4 }}>
                    <Button
                      aria-label={`Approve ${c.label}`}
                      disabled={pending}
                      onClick={() => {
                        pick(`${c.id}:approved`);
                      }}
                    >
                      <Check aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label={`Reject ${c.label}`}
                      disabled={pending}
                      onClick={() => {
                        pick(`${c.id}:rejected`);
                      }}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                </figure>
              ))}
            </div>
            <UploadButton avatarId={a.id} step="face_pack" run={run} pending={pending} />
          </>
        ) : null}

        {step === "voice" && s.voices ? (
          <div className={styles.list} role="radiogroup" aria-label="Voices">
            {s.voices.map((v, i) => (
              <label key={v.key} className={styles.item} data-selected={s.voice_pick === v.key}>
                <input
                  type="radio"
                  name="voice"
                  checked={s.voice_pick === v.key}
                  onChange={() => {
                    pick(v.key);
                  }}
                  disabled={pending}
                />
                <span className={styles.itemBody}>
                  {/* Blind: names show after the pick. */}
                  <span className={styles.itemTitle}>
                    {s.voice_pick ? v.label : `Voice ${String.fromCharCode(65 + i)}`}
                  </span>
                </span>
                <AudioPlayButton
                  src={v.sample_url}
                  label={`voice ${String.fromCharCode(65 + i)}`}
                />
              </label>
            ))}
          </div>
        ) : null}

        {step === "screen_test" && s.screen_tests ? (
          <div className={styles.list} role="radiogroup" aria-label="Screen tests">
            {s.screen_tests.map((t) => (
              <label
                key={t.model}
                className={styles.item}
                data-selected={s.screen_pick === t.model}
              >
                <input
                  type="radio"
                  name="screen"
                  checked={s.screen_pick === t.model}
                  onChange={() => {
                    pick(t.model);
                  }}
                  disabled={pending}
                />
                <span className={styles.itemBody}>
                  <span className={styles.itemTitle}>{t.model}</span>
                  <span className={styles.meta}>10 s clip, {usd(t.cost_usd)}</span>
                </span>
              </label>
            ))}
          </div>
        ) : null}

        <div className={styles.row}>
          <Button
            variant="primary"
            disabled={pending || Boolean(missing)}
            onClick={() => {
              run(
                () => advanceStudio(a.id),
                (m) => m,
              );
            }}
          >
            {step === "screen_test" ? `Approve and save as v${a.version + 1}` : "Continue"}
          </Button>
          {missing ? <span className={styles.meta}>{missing}</span> : null}
        </div>
      </div>
    </section>
  );
}

function Grid({
  items,
  selected,
  onPick,
  pending,
  label,
}: {
  items: { id: string; url: string; label: string }[];
  selected?: string;
  onPick: (id: string) => void;
  pending: boolean;
  label: string;
}) {
  return (
    <div className={styles.styles} role="radiogroup" aria-label={label}>
      {items.map((c) => (
        <label key={c.id} className={styles.card} data-selected={selected === c.id}>
          <input
            type="radio"
            name={label}
            checked={selected === c.id}
            onChange={() => {
              onPick(c.id);
            }}
            disabled={pending}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.frame} src={c.url} alt={c.label} />
          <span>{c.label}</span>
        </label>
      ))}
    </div>
  );
}

function UploadButton({
  avatarId,
  step,
  run,
  pending,
}: {
  avatarId: string;
  step: "portrait" | "face_pack";
  run: Run;
  pending: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={styles.money} style={{ cursor: "pointer" }}>
      <Upload aria-hidden="true" width={14} height={14} />
      {busy ? "Uploading…" : "Upload an image (JPEG or PNG)"}
      <input
        type="file"
        accept="image/jpeg,image/png"
        hidden
        disabled={pending || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          void (async () => {
            const ticket = await avatarUpload(avatarId, file.type);
            if (ticket.ok) {
              const put = await fetch(ticket.value.uploadUrl, {
                method: "PUT",
                headers: { "content-type": file.type },
                body: file,
              });
              if (put.ok)
                run(
                  () => addUploadedCandidate(avatarId, step, ticket.value.ref, file.name),
                  "Uploaded.",
                );
            }
            setBusy(false);
          })();
        }}
      />
    </label>
  );
}

function ProfileForm(props: {
  avatar: AvatarData;
  accounts: { id: string; handle: string }[];
  models: { key: string; label: string }[];
  voices: { key: string; label: string }[];
  run: Run;
  pending: boolean;
}) {
  const p = props.avatar.profile as {
    identity?: { backstory?: string };
    personality?: { tone?: string };
    voice?: { voice_id?: string };
    generation?: {
      face_model?: string | null;
      fallback_model?: string | null;
      seed?: number | null;
      resolution?: string;
      cost_cap_per_video_usd?: number | null;
    };
    notes?: string;
  };
  const g = p.generation ?? {};
  const [name, setName] = useState(props.avatar.name);
  const [accountId, setAccountId] = useState(props.avatar.accountId ?? "");
  const [backstory, setBackstory] = useState(p.identity?.backstory ?? "");
  const [tone, setTone] = useState(p.personality?.tone ?? "");
  const [voiceKey, setVoiceKey] = useState(p.voice?.voice_id ?? "");
  const [faceModel, setFaceModel] = useState(g.face_model ?? "");
  const [fallback, setFallback] = useState(g.fallback_model ?? "");
  const [seed, setSeed] = useState(g.seed?.toString() ?? "");
  const [resolution, setResolution] = useState(g.resolution ?? "720p");
  const [cap, setCap] = useState(g.cost_cap_per_video_usd?.toString() ?? "");
  const [notes, setNotes] = useState(p.notes ?? "");
  return (
    <section className={styles.section} aria-labelledby="profile-h">
      <div className={styles.sectionHead}>
        <h2 id="profile-h">Profile</h2>
      </div>
      <p className={styles.help}>
        The avatar.json a video session gets. Changing the look or voice saves a new version.
      </p>
      <div className={styles.row}>
        <label className={styles.field} style={{ flex: "1 1 200px" }}>
          Name
          <input
            className={styles.input}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label className={styles.field} style={{ flex: "1 1 200px" }}>
          Account
          <select
            className={styles.select}
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
            }}
          >
            <option value="">No account</option>
            {props.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.handle}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={styles.field}>
        Backstory
        <textarea
          className={styles.textarea}
          value={backstory}
          onChange={(e) => {
            setBackstory(e.target.value);
          }}
        />
      </label>
      <label className={styles.field}>
        Tone
        <input
          className={styles.input}
          value={tone}
          onChange={(e) => {
            setTone(e.target.value);
          }}
        />
      </label>
      <div className={styles.row}>
        <label className={styles.field} style={{ flex: "1 1 200px" }}>
          Voice
          <select
            className={styles.select}
            value={voiceKey}
            onChange={(e) => {
              setVoiceKey(e.target.value);
            }}
            aria-label="Avatar voice"
          >
            <option value="">Not chosen</option>
            {props.voices.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field} style={{ flex: "1 1 200px" }}>
          Face model (avatar default)
          <select
            className={styles.select}
            value={faceModel}
            onChange={(e) => {
              setFaceModel(e.target.value);
            }}
            aria-label="Avatar face model"
          >
            <option value="">Account or workspace default</option>
            {props.models.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field} style={{ flex: "1 1 200px" }}>
          Fallback model
          <select
            className={styles.select}
            value={fallback}
            onChange={(e) => {
              setFallback(e.target.value);
            }}
            aria-label="Avatar fallback model"
          >
            <option value="">None</option>
            {props.models.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          Seed
          <input
            className={styles.input}
            type="number"
            value={seed}
            onChange={(e) => {
              setSeed(e.target.value);
            }}
          />
        </label>
        <label className={styles.field}>
          Resolution
          <select
            className={styles.select}
            value={resolution}
            onChange={(e) => {
              setResolution(e.target.value);
            }}
          >
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </label>
        <label className={styles.field}>
          Cap per video ($)
          <input
            className={styles.input}
            type="number"
            min={0}
            step={0.5}
            value={cap}
            onChange={(e) => {
              setCap(e.target.value);
            }}
            placeholder="Workspace cap"
          />
        </label>
      </div>
      <label className={styles.field}>
        Notes (what worked)
        <textarea
          className={styles.textarea}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
        />
      </label>
      <div className={styles.row}>
        <Button
          variant="primary"
          disabled={props.pending}
          onClick={() => {
            props.run(
              () =>
                saveProfile(props.avatar.id, {
                  name,
                  accountId: accountId || null,
                  backstory,
                  tone,
                  voiceKey: voiceKey || null,
                  faceModel: faceModel || null,
                  fallbackModel: fallback || null,
                  seed: seed === "" ? null : Number(seed),
                  resolution,
                  capUsd: cap === "" ? null : Number(cap),
                  notes,
                }),
              (m) => m,
            );
          }}
        >
          Save profile
        </Button>
      </div>
    </section>
  );
}
