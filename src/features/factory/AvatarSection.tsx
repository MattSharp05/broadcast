"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import type { VideoPatch } from "@/app/(app)/factory/actions";
import type { FactoryOptions, ProductionPage } from "@/lib/db/factory-page";
import { usd } from "@/lib/domain/factory/budget";
import styles from "./factory.module.css";

/**
 * Section 3: UGC avatar yes or no; pick a saved avatar or create one; pick the model for its
 * clips. The account default, then the avatar default, then this video's override.
 */
export function AvatarSection({
  video,
  options,
  draft,
  save,
  pending,
}: {
  video: ProductionPage;
  options: FactoryOptions;
  draft: boolean;
  save: (patch: VideoPatch) => void;
  pending: boolean;
}) {
  const locked = !draft || pending;
  const avatar = options.avatars.find((a) => a.id === video.avatarId);
  const account = options.accounts.find((a) => a.id === (avatar?.accountId ?? video.accountId));
  const inherited = avatar?.faceModel ?? account?.faceModel ?? options.defaultFaceModel;
  const inheritedFrom = avatar?.faceModel
    ? `${avatar.name}'s default`
    : account?.faceModel
      ? `@${account.handle}'s default`
      : "the workspace default";
  const chosen = video.faceModel ?? inherited;

  return (
    <section id="avatar" className={styles.section} aria-labelledby="avatar-h">
      <div className={styles.sectionHead}>
        <h2 id="avatar-h">3. UGC avatar</h2>
        <div className={styles.grow} />
        <div className={styles.segmented} role="group" aria-label="Use a UGC avatar">
          <button
            type="button"
            aria-pressed={!video.useAvatar}
            disabled={locked}
            onClick={() => {
              save({ useAvatar: false });
            }}
          >
            No
          </button>
          <button
            type="button"
            aria-pressed={video.useAvatar}
            disabled={locked}
            onClick={() => {
              save({ useAvatar: true });
            }}
          >
            Yes
          </button>
        </div>
      </div>
      {!video.useAvatar ? (
        <p className={styles.help}>
          No avatar: the video is all animation and voiceover. Nothing here costs money.
        </p>
      ) : (
        <>
          <p className={styles.help}>
            The avatar appears in short cut-ins (about 15 s of a 60 s video), always disclosed as
            AI. Its clips are the only paid part.
          </p>
          <div
            className={styles.list}
            role="radiogroup"
            aria-label="Avatar"
            data-testid="avatar-list"
          >
            {options.avatars.map((a) => {
              const usable = a.version >= 1;
              const handle = options.accounts.find((x) => x.id === a.accountId)?.handle;
              return (
                <label
                  key={a.id}
                  className={styles.item}
                  data-selected={video.avatarId === a.id}
                  aria-disabled={!usable || locked}
                >
                  <input
                    type="radio"
                    name="avatar"
                    checked={video.avatarId === a.id}
                    disabled={!usable || locked}
                    onChange={() => {
                      save({ avatarId: a.id });
                    }}
                  />
                  <span className={styles.itemBody}>
                    <span className={styles.itemTitle}>
                      {a.name} {usable ? `v${a.version}` : "(draft)"}
                    </span>
                    <span className={styles.meta}>
                      {handle ? `@${handle}` : "No account yet"}
                      {a.capUsd !== null ? `, cap ${usd(a.capUsd)} a video` : ""}
                      {!usable ? ". Finish it in the Avatar studio to use it." : ""}
                    </span>
                  </span>
                  <Link
                    href={`/factory/avatars/${a.id}`}
                    className={styles.meta}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    Open
                  </Link>
                </label>
              );
            })}
            {options.avatars.length === 0 ? (
              <p className={`${styles.item} ${styles.meta}`}>No avatars saved yet.</p>
            ) : null}
          </div>
          <div className={styles.row}>
            <Link href="/factory/avatars/new" className={styles.titleLink}>
              <Plus aria-hidden="true" width={14} height={14} /> Create a new avatar
            </Link>
          </div>

          <h3 className={styles.itemTitle} style={{ margin: 0 }}>
            Model for avatar clips
          </h3>
          <p className={styles.help}>
            Using <b>{options.models.find((m) => m.key === chosen)?.label ?? chosen}</b>
            {video.faceModel ? " (this video's choice)" : ` (${inheritedFrom})`}. Planned models are
            listed but can&apos;t be picked yet.
          </p>
          <div
            className={styles.list}
            role="radiogroup"
            aria-label="Face model"
            data-testid="model-list"
          >
            {options.models.map((m) => {
              const pickable = m.selectable && m.enabled;
              return (
                <label
                  key={m.key}
                  className={styles.item}
                  data-selected={chosen === m.key}
                  aria-disabled={!pickable || pending}
                  data-model={m.key}
                >
                  <input
                    type="radio"
                    name="face-model"
                    checked={chosen === m.key}
                    disabled={!pickable || pending || video.status === "scheduled"}
                    onChange={() => {
                      save({ faceModel: m.key === inherited ? null : m.key });
                    }}
                  />
                  <span className={styles.itemBody}>
                    <span className={styles.itemTitle}>{m.label}</span>
                    <span className={styles.meta}>
                      {m.free ? "Free" : `${usd(m.pricePerS)}/s`}, up to {m.maxS} s, {m.status}
                      {!m.selectable && m.status !== "planned" ? ", needs a key in Settings" : ""}
                      {m.selectable && !m.enabled ? ", not enabled in Settings" : ""}
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
        </>
      )}
    </section>
  );
}
