"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import {
  newVideo,
  saveVideo,
  type FactoryResult,
  type VideoPatch,
} from "@/app/(app)/factory/actions";
import { Button, ButtonLink } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { StatusDot } from "@/components/StatusDot";
import { Toast } from "@/components/Toast";
import type { FactoryOptions, ProductionPage } from "@/lib/db/factory-page";
import type { StudioData } from "@/lib/db/studio-page";
import { STUDIO_TABS } from "./studio/tabs";
import studio from "./studio/studio.module.css";
import { usd } from "@/lib/domain/factory/budget";
import { AudioPlayButton } from "./AudioPlayButton";
import { AvatarSection } from "./AvatarSection";
import { PipelineSection } from "./PipelineSection";
import { HeroSection } from "./HeroSection";
import { ReworkSection } from "./ReworkSection";
import { CaptionSection } from "./CaptionSection";
import { GenreTagsField } from "./GenreTagsField";
import { StyleSection } from "./StyleSection";
import { STATUS_TONE, STATUS_WORD } from "./status";
import styles from "./factory.module.css";
import { TextArea } from "@/components/TextArea";

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
  studio: studioData,
  tab: firstTab,
}: {
  video: ProductionPage;
  options: FactoryOptions;
  studio: StudioData;
  tab: string;
}) {
  const { pending, run, notify, toastEl } = useFactoryAction();
  const [tab, setTab] = useState(firstTab);
  const current = STUDIO_TABS.find((t) => t.key === tab) ?? STUDIO_TABS[0];
  const Panel = current?.Panel;
  const pick = (key: string) => {
    setTab(key);
    // In the URL, so a reload or a shared link opens the same tab.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.replaceState(window.history.state, "", url);
  };
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
        <div className={studio.tabs} role="tablist" aria-label="Video">
          {STUDIO_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={t.key === current?.key}
              aria-controls={`panel-${t.key}`}
              className={studio.tab}
              onClick={() => {
                pick(t.key);
              }}
            >
              {t.label}
              {t.key === "versions" && studioData.versions.length ? (
                <span className={studio.tabCount}>{studioData.versions.length}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`panel-${current?.key ?? "make"}`}
          aria-labelledby={`tab-${current?.key ?? "make"}`}
        >
          {Panel ? (
            <Panel
              video={video}
              options={options}
              studio={studioData}
              run={run}
              notify={notify}
              pending={pending}
            />
          ) : (
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
                <StyleSection video={video} draft={draft} save={save} run={run} pending={pending} />
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
                <CaptionSection
                  video={video}
                  hasVersions={studioData.versions.length > 0}
                  save={save}
                  pending={pending}
                  onOpenReady={() => {
                    pick("ready");
                  }}
                />
                <ScheduleSection
                  video={video}
                  options={options}
                  run={run}
                  pending={pending}
                  onOpenReady={() => {
                    pick("ready");
                  }}
                />
              </div>
            </div>
          )}
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
        <TextArea
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
      <GenreTagsField genre={video.genre} tags={video.tags} save={save} pending={pending} />
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

/** The Make tab's last section: scheduling lives on Ready to post (BC-43); this links there. */
function ScheduleSection({
  video,
  options,
  run,
  pending,
  onOpenReady,
}: {
  video: ProductionPage;
  options: FactoryOptions;
  run: ReturnType<typeof useFactoryAction>["run"];
  pending: boolean;
  onOpenReady: () => void;
}) {
  return (
    <section id="schedule" className={styles.section} aria-labelledby="schedule-h">
      <div className={styles.sectionHead}>
        <h2 id="schedule-h">9. Schedule</h2>
      </div>
      {video.post ? (
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
      ) : (
        <p className={styles.help}>
          Pick a version, its cover and caption on Ready to post, mark it ready, then assign it to
          an account and schedule it there.
        </p>
      )}
      <div className={styles.row}>
        <Button onClick={onOpenReady}>Open Ready to post</Button>
        {video.post ? (
          <>
            <ButtonLink href="/workflow">Open the Workflow</ButtonLink>
            <RemakeButton video={video} options={options} run={run} pending={pending} />
          </>
        ) : null}
      </div>
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
