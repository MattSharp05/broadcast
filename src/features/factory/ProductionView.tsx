"use client";

import { ArrowLeft, ExternalLink, Play } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import {
  newVideo,
  saveVideo,
  scheduleVideo,
  type FactoryResult,
  type VideoPatch,
} from "@/app/(app)/factory/actions";
import { Button, ButtonLink } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { StatusDot } from "@/components/StatusDot";
import { Toast } from "@/components/Toast";
import type { FactoryOptions, ProductionPage } from "@/lib/db/factory-page";
import { usd } from "@/lib/domain/factory/budget";
import { STYLE_PACKS } from "@/lib/domain/factory/styles";
import { AudioPlayButton } from "./AudioPlayButton";
import { AvatarSection } from "./AvatarSection";
import { PipelineSection } from "./PipelineSection";
import { HeroSection } from "./HeroSection";
import { ReworkSection } from "./ReworkSection";
import { CaptionSection } from "./CaptionSection";
import { STATUS_TONE, STATUS_WORD } from "./status";
import styles from "./factory.module.css";

export interface ToastState {
  message: string;
  id: number;
  tone?: "error";
}

export type Notify = (message: string, tone?: "error") => void;

/** Runs a factory action: toasts the error, or the success words. */
export function useFactoryAction() {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<ToastState | null>(null);
  const notify: Notify = useCallback((message, tone) => {
    setToast({ message, id: Date.now(), tone });
  }, []);
  const run = useCallback(
    <T,>(fn: () => Promise<FactoryResult<T>>, success?: string | ((v: T) => string | null)) => {
      startTransition(async () => {
        const res = await fn();
        if (!res.ok) notify(res.error, "error");
        else if (success) {
          const msg = typeof success === "string" ? success : success(res.value);
          if (msg) notify(msg);
        }
      });
    },
    [notify],
  );
  const toastEl = (
    <Toast
      message={toast?.message ?? null}
      id={toast?.id}
      tone={toast?.tone}
      onDone={() => {
        setToast(null);
      }}
    />
  );
  return { pending, run, notify, toastEl };
}

const SECTIONS = [
  ["idea", "1. Idea"],
  ["style", "2. Style"],
  ["avatar", "3. UGC avatar"],
  ["voice", "4. Voiceover"],
  ["music", "5. Music"],
  ["render", "6. Visuals and render"],
  ["hero", "Hero 3D assets"],
  ["rework", "7. Rework"],
  ["caption", "8. Caption"],
  ["schedule", "9. Schedule"],
] as const;

export function ProductionView({
  video,
  options,
}: {
  video: ProductionPage;
  options: FactoryOptions;
}) {
  const { pending, run, notify, toastEl } = useFactoryAction();
  const draft = video.status === "draft";
  const save = (patch: VideoPatch) => {
    run(() => saveVideo(video.id, patch));
  };

  return (
    <>
      <PageHeader
        title={video.title || video.idea || "New video"}
        stats={[
          {
            value: (
              <StatusDot tone={STATUS_TONE[video.status] ?? "neutral"}>
                {STATUS_WORD[video.status] ?? video.status}
              </StatusDot>
            ),
            label: "",
          },
          {
            value: usd(video.spend.videoUsd),
            label: `spent on this video (cap ${usd(video.spend.capVideoUsd)})`,
          },
          {
            value: `${usd(video.spend.monthUsd)} of ${usd(video.spend.capMonthUsd)}`,
            label: "this month",
            labelFirst: false,
          },
        ]}
        actions={
          <>
            <ButtonLink href="/factory" variant="ghost">
              <ArrowLeft aria-hidden="true" />
              All videos
            </ButtonLink>
            {video.sessionUrl ? (
              <ButtonLink href={video.sessionUrl} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" />
                Watch session
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className={styles.page}>
        <div className={styles.layout}>
          <nav aria-label="Sections" className={styles.tocNav}>
            <ul className={styles.toc}>
              {SECTIONS.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`}>{label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className={styles.sections}>
            <IdeaSection video={video} draft={draft} save={save} pending={pending} />
            <StyleSection video={video} draft={draft} save={save} pending={pending} />
            <AvatarSection
              video={video}
              options={options}
              draft={draft}
              save={save}
              pending={pending}
            />
            <VoiceSection
              video={video}
              options={options}
              draft={draft}
              save={save}
              pending={pending}
            />
            <MusicSection
              video={video}
              options={options}
              draft={draft}
              save={save}
              pending={pending}
            />
            <PipelineSection
              video={video}
              options={options}
              run={run}
              notify={notify}
              pending={pending}
            />
            <HeroSection video={video} options={options} run={run} pending={pending} />
            <ReworkSection video={video} run={run} pending={pending} />
            <CaptionSection video={video} save={save} pending={pending} />
            <ScheduleSection video={video} options={options} run={run} pending={pending} />
          </div>
        </div>
      </div>
      {toastEl}
    </>
  );
}

interface SectionProps {
  video: ProductionPage;
  draft: boolean;
  save: (patch: VideoPatch) => void;
  pending: boolean;
}

function IdeaSection({ video, save, pending }: SectionProps) {
  const [idea, setIdea] = useState(video.idea);
  const [title, setTitle] = useState(video.title);
  const dirty = idea !== video.idea || title !== video.title;
  return (
    <section id="idea" className={styles.section} aria-labelledby="idea-h">
      <div className={styles.sectionHead}>
        <h2 id="idea-h">1. Idea</h2>
      </div>
      <p className={styles.help}>
        What the video explains, in a sentence or two. Claude turns it into a brief.
      </p>
      <label className={styles.field}>
        Idea
        <textarea
          className={styles.textarea}
          value={idea}
          onChange={(e) => {
            setIdea(e.target.value);
          }}
          placeholder="How the moon causes tides"
          maxLength={2000}
        />
      </label>
      <label className={styles.field}>
        Working title (optional)
        <input
          className={styles.input}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
          maxLength={120}
        />
      </label>
      <div className={styles.row}>
        <Button
          disabled={!dirty || pending}
          onClick={() => {
            save({ idea, title });
          }}
        >
          Save idea
        </Button>
      </div>
    </section>
  );
}

function StyleSection({ video, draft, save, pending }: SectionProps) {
  return (
    <section id="style" className={styles.section} aria-labelledby="style-h">
      <div className={styles.sectionHead}>
        <h2 id="style-h">2. Style</h2>
        <span className={styles.meta}>The animated-video style packs</span>
      </div>
      <div className={styles.styles} role="radiogroup" aria-labelledby="style-h">
        {STYLE_PACKS.map((s) => {
          const selected = video.style === s.key;
          const locked = !draft || pending;
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

interface OptionSectionProps extends SectionProps {
  options: FactoryOptions;
}

function VoiceSection({ video, options, save, pending }: OptionSectionProps) {
  return (
    <section id="voice" className={styles.section} aria-labelledby="voice-h">
      <div className={styles.sectionHead}>
        <h2 id="voice-h">4. Voiceover</h2>
        <span className={styles.free}>Free (Qwen3-TTS runs in the session)</span>
      </div>
      <div
        className={styles.list}
        role="radiogroup"
        aria-labelledby="voice-h"
        data-testid="voice-list"
      >
        {options.voices.map((v) => (
          <label
            key={v.key}
            className={styles.item}
            data-selected={video.voiceKey === v.key}
            data-voice={v.key}
          >
            <input
              type="radio"
              name="voice"
              checked={video.voiceKey === v.key}
              disabled={pending || video.status === "scheduled"}
              onChange={() => {
                save({ voiceKey: v.key });
              }}
            />
            <span className={styles.itemBody}>
              <span className={styles.itemTitle}>{v.label}</span>
              <span className={styles.meta}>{v.description}</span>
              <span className={styles.meta}>
                {v.credit}. {v.sampleUrl ? "" : "No sample clip yet."}
              </span>
            </span>
            <AudioPlayButton src={v.sampleUrl} label={v.label} />
          </label>
        ))}
      </div>
      {!isDraft(video) ? (
        <p className={styles.help}>
          To change the voice after the render, use Rework → Voice. Avatar clips are kept.
        </p>
      ) : null}
    </section>
  );
}

function isDraft(video: ProductionPage): boolean {
  return video.status === "draft";
}

function MusicSection({ video, options, save, pending }: OptionSectionProps) {
  return (
    <section id="music" className={styles.section} aria-labelledby="music-h">
      <div className={styles.sectionHead}>
        <h2 id="music-h">5. Music</h2>
        <span className={styles.meta}>
          Baked into the video (Instagram&apos;s music library isn&apos;t available to the API)
        </span>
      </div>
      <div
        className={styles.list}
        role="radiogroup"
        aria-labelledby="music-h"
        data-testid="music-list"
      >
        {options.music.map((m) => (
          <label
            key={m.key}
            className={styles.item}
            data-selected={video.musicKey === m.key}
            data-track={m.key}
          >
            <input
              type="radio"
              name="music"
              checked={video.musicKey === m.key}
              disabled={pending || video.status === "scheduled"}
              onChange={() => {
                save({ musicKey: m.key });
              }}
            />
            <span className={styles.itemBody}>
              <span className={styles.itemTitle}>
                {m.title}, {m.artist}
              </span>
              <span className={styles.meta}>
                {m.licence}
                {m.mood ? `, ${m.mood}` : ""}.{" "}
                <a href={m.sourceUrl} target="_blank" rel="noreferrer">
                  Source
                </a>
              </span>
              <span className={styles.meta}>Credit: {m.credit}</span>
            </span>
            <AudioPlayButton src={m.sampleUrl} label={m.title} />
          </label>
        ))}
      </div>
    </section>
  );
}

function ScheduleSection({
  video,
  options,
  run,
  pending,
}: {
  video: ProductionPage;
  options: FactoryOptions;
  run: ReturnType<typeof useFactoryAction>["run"];
  pending: boolean;
}) {
  const [accountId, setAccountId] = useState(video.accountId ?? options.accounts[0]?.id ?? "");
  const [kind, setKind] = useState<"queue" | "pinned">("queue");
  const [local, setLocal] = useState("");
  const account = options.accounts.find((a) => a.id === accountId);
  const ready = video.status === "ready" && video.mediaId;

  return (
    <section id="schedule" className={styles.section} aria-labelledby="schedule-h">
      <div className={styles.sectionHead}>
        <h2 id="schedule-h">9. Schedule</h2>
      </div>
      {video.post ? (
        <>
          <p className={styles.help} data-testid="scheduled">
            Queued on <b>@{video.post.handle}</b>
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
            <RemakeButton video={video} options={options} run={run} pending={pending} />
          </div>
        </>
      ) : (
        <>
          <p className={styles.help}>
            One video goes to one account. To post it on another account, remake it there (new
            wording, hook and voice).
          </p>
          <div className={styles.row}>
            <label className={styles.field} style={{ flex: "1 1 220px" }}>
              Account
              <select
                className={styles.select}
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                }}
                disabled={pending}
              >
                {options.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    @{a.handle}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.field}>
              When
              <div className={styles.segmented}>
                <button
                  type="button"
                  aria-pressed={kind === "queue"}
                  onClick={() => {
                    setKind("queue");
                  }}
                >
                  Next open slot
                </button>
                <button
                  type="button"
                  aria-pressed={kind === "pinned"}
                  onClick={() => {
                    setKind("pinned");
                  }}
                >
                  Pinned time
                </button>
              </div>
            </div>
            {kind === "pinned" ? (
              <label className={styles.field}>
                Time ({options.timezone})
                <input
                  className={styles.input}
                  type="datetime-local"
                  value={local}
                  onChange={(e) => {
                    setLocal(e.target.value);
                  }}
                />
              </label>
            ) : null}
          </div>
          {kind === "queue" && account ? (
            <p className={styles.help}>
              {account.nextSlot ? (
                <>
                  Next slot on @{account.handle}: {account.nextSlot} (after its backlog).
                </>
              ) : (
                <>@{account.handle} has no slots yet: the post waits in the backlog.</>
              )}
            </p>
          ) : null}
          {video.useAvatar && account && !(account.aiLabelDone && account.aiBioDone) ? (
            <div className={styles.notice} role="note">
              Avatar videos are disclosed as AI. On @{account.handle}, turn on Instagram&apos;s
              AI-generated profile label and add “AI creator” to the bio (Accounts → the account).
              Posts from the factory are marked is_ai_generated.
            </div>
          ) : null}
          <div className={styles.row}>
            <Button
              variant="primary"
              disabled={!ready || !accountId || pending || (kind === "pinned" && !local)}
              onClick={() => {
                run(
                  () =>
                    scheduleVideo(video.id, {
                      accountId,
                      timing: kind === "queue" ? { kind } : { kind, local },
                    }),
                  (m) => m,
                );
              }}
            >
              <Play aria-hidden="true" />
              Add to queue
            </Button>
            {!ready ? <span className={styles.meta}>Approve the render first.</span> : null}
          </div>
        </>
      )}
    </section>
  );
}

function RemakeButton({
  video,
  options,
  run,
  pending,
}: {
  video: ProductionPage;
  options: FactoryOptions;
  run: ReturnType<typeof useFactoryAction>["run"];
  pending: boolean;
}) {
  const others = options.accounts.filter((a) => a.id !== video.accountId);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  if (!others.length) return null;
  return (
    <>
      <select
        className={styles.select}
        style={{ width: "auto" }}
        aria-label="Remake for account"
        value={target}
        onChange={(e) => {
          setTarget(e.target.value);
        }}
      >
        {others.map((a) => (
          <option key={a.id} value={a.id}>
            @{a.handle}
          </option>
        ))}
      </select>
      <Button
        disabled={pending || !target}
        onClick={() => {
          run(
            () => newVideo({ remakeOf: video.id, accountId: target }),
            (id) => {
              window.location.assign(`/factory/${id}`);
              return null;
            },
          );
        }}
      >
        Remake for @{others.find((a) => a.id === target)?.handle}
      </Button>
    </>
  );
}
