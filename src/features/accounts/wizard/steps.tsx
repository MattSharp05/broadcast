"use client";

import { ExternalLink, Info, KeyRound, Plus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { PlatformGlyph } from "@/components/PlatformGlyph";
import { Tag } from "@/components/Tag";
import { BRAND_NAME_MAX, DESCRIPTION_MAX, type BrandRef } from "@/lib/domain/accounts";
import {
  NEW_BRAND,
  SIGNUP_CHECKS,
  SLOTS_MAX,
  addSlot,
  cleanVaultUrl,
  type SignupCheck,
  type WizardDraft,
} from "@/lib/domain/add-account";
import { TAG_MAX_LENGTH, addTag, removeTag, tagSuggestions } from "@/lib/domain/tags";
import styles from "./wizard.module.css";

export const INSTAGRAM_SIGNUP_URL = "https://www.instagram.com/accounts/emailsignup/";
export const INSTAGRAM_TESTER_INVITES_URL = "https://www.instagram.com/accounts/manage_access/";
export const BITWARDEN_URL = "https://vault.bitwarden.com/";

export interface StepProps {
  draft: WizardDraft;
  update: (patch: Partial<WizardDraft>) => void;
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className={styles.extBtn} href={href} target="_blank" rel="noopener noreferrer">
      <ExternalLink aria-hidden="true" />
      {children}
    </a>
  );
}

export function Note({
  tone = "info",
  icon,
  children,
}: {
  tone?: "info" | "good" | "warn" | "bad";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.note} data-tone={tone}>
      {icon ?? <Info aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}

/* ───────────── 1 Platform + brand ───────────── */

const PLATFORMS = [
  { id: "instagram", name: "Instagram", help: "Reels and stats. Available now.", enabled: true },
  {
    id: "tiktok",
    name: "TikTok",
    help: "Coming in v1, after TikTok reviews the app.",
    enabled: false,
  },
  { id: "youtube", name: "YouTube Shorts", help: "Not planned yet.", enabled: false },
] as const;

export function PlatformStep({
  draft,
  update,
  brands,
  brandError,
}: StepProps & { brands: readonly BrandRef[]; brandError: string | null }) {
  const brandId = useId();
  return (
    <>
      <fieldset className={styles.field}>
        <legend className={styles.label}>Platform</legend>
        <div className={styles.pick}>
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.opt}
              aria-pressed={p.enabled}
              disabled={!p.enabled}
            >
              <PlatformGlyph platform={p.id} />
              <b>{p.name}</b>
              <span>{p.help}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className={styles.field}>
        <label htmlFor={brandId} className={styles.label}>
          Brand
        </label>
        <select
          id={brandId}
          className={styles.input}
          value={draft.brandId}
          onChange={(e) => {
            update({ brandId: e.target.value });
          }}
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
          <option value={NEW_BRAND}>New brand</option>
        </select>
        {draft.brandId === NEW_BRAND ? (
          <input
            className={styles.input}
            aria-label="New brand name"
            placeholder="Brand name, for example Kart Racer"
            maxLength={BRAND_NAME_MAX}
            value={draft.newBrand}
            aria-invalid={brandError ? true : undefined}
            onChange={(e) => {
              update({ newBrand: e.target.value });
            }}
          />
        ) : null}
        {brandError ? (
          <p className={styles.error} role="alert">
            {brandError}
          </p>
        ) : null}
        <span className={styles.help}>
          A brand groups the accounts that share one audience, such as Coding Journey on Instagram
          and TikTok.
        </span>
      </div>
    </>
  );
}

/* ───────────── 2 Create the account ───────────── */

const CHECK_COPY: Record<SignupCheck, { title: string; help: React.ReactNode }> = {
  verified: {
    title: "Account created and email or phone verified",
    help: "Use a separate email alias for each account so recovery stays independent.",
  },
  creator: {
    title: "Switched to a professional account (Creator)",
    help: "Instagram settings, then Account type and tools. Publishing through the API needs this.",
  },
  tester: {
    title: "Tester invite for Broadcast accepted",
    help: (
      <>
        Instagram settings, then Apps and websites, then Tester invites.{" "}
        <a href={INSTAGRAM_TESTER_INVITES_URL} target="_blank" rel="noopener noreferrer">
          Open tester invites
        </a>
      </>
    ),
  },
};

export function SignupStep({ draft, update }: StepProps) {
  const usernameId = useId();
  return (
    <>
      <Note>
        Instagram doesn&rsquo;t let apps create accounts, and its sign-up page can&rsquo;t load
        inside Broadcast. Sign up in a new tab, then come back to this checklist.
      </Note>
      <div className={styles.actions}>
        <ExtLink href={INSTAGRAM_SIGNUP_URL}>Open Instagram sign-up</ExtLink>
      </div>
      <div className={styles.field}>
        <label htmlFor={usernameId} className={styles.label}>
          Username
        </label>
        <input
          id={usernameId}
          className={styles.input}
          placeholder="kartracer.dev"
          autoComplete="off"
          spellCheck={false}
          maxLength={31}
          value={draft.username}
          onChange={(e) => {
            update({ username: e.target.value.replace(/^@/, "") });
          }}
        />
      </div>
      {SIGNUP_CHECKS.map((c) => (
        <label key={c} className={styles.check}>
          <input
            type="checkbox"
            checked={draft.checks[c]}
            onChange={(e) => {
              update({ checks: { ...draft.checks, [c]: e.target.checked } });
            }}
          />
          <span>
            <b>{CHECK_COPY[c].title}</b>
            <span>{CHECK_COPY[c].help}</span>
          </span>
        </label>
      ))}
    </>
  );
}

/* ───────────── 3 Save the login ───────────── */

export function LoginStep({ draft, update }: StepProps) {
  const vaultId = useId();
  const helpId = useId();
  const invalid = !cleanVaultUrl(draft.vaultUrl).valid;
  return (
    <>
      <Note icon={<KeyRound aria-hidden="true" />}>
        Broadcast never stores passwords. It posts with an access token from the next step, so you
        only need the login when you open Instagram yourself. Save it in your password manager.
      </Note>
      <div className={styles.actions}>
        <ExtLink href={BITWARDEN_URL}>Open Bitwarden</ExtLink>
      </div>
      <div className={styles.field}>
        <label htmlFor={vaultId} className={styles.label}>
          Link to the vault item (optional)
        </label>
        <input
          id={vaultId}
          className={styles.input}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://vault.bitwarden.com/#/vault?itemId="
          value={draft.vaultUrl}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={helpId}
          onChange={(e) => {
            update({ vaultUrl: e.target.value });
          }}
        />
        {invalid ? (
          <p id={helpId} className={styles.error} role="alert">
            Paste the item&rsquo;s https:// link from the vault, or leave this empty.
          </p>
        ) : (
          <span id={helpId} className={styles.help}>
            Shown on the account so you can find the login quickly.
          </span>
        )}
      </div>
      <Note>
        Turn on two-factor authentication in Instagram and keep the recovery codes in the vault
        item. Recommended for every account.
      </Note>
    </>
  );
}

/* ───────────── 5 Set up posting ───────────── */

export function PostingStep({
  draft,
  update,
  allTags,
}: StepProps & { allTags: readonly string[] }) {
  const listId = useId();
  const descId = useId();
  const tagInput = useRef<HTMLInputElement>(null);
  const [slotInput, setSlotInput] = useState("");

  const addTyped = (input: HTMLInputElement) => {
    const next = addTag(draft.tags, input.value, allTags);
    input.value = "";
    if (next) update({ tags: next });
  };
  const addTypedSlot = () => {
    const next = addSlot(draft.slots, slotInput);
    if (next) {
      update({ slots: next });
      setSlotInput("");
    }
  };

  return (
    <>
      <div className={styles.field}>
        <span className={styles.label} id={`${listId}-label`}>
          Tags
        </span>
        <div className={styles.tags} role="group" aria-labelledby={`${listId}-label`}>
          {draft.tags.map((t) => (
            <Tag
              key={t}
              label={t}
              onRemove={() => {
                update({ tags: removeTag(draft.tags, t) });
              }}
            />
          ))}
          <input
            ref={tagInput}
            className={styles.tagInput}
            placeholder="Add a tag"
            aria-label="Add a tag"
            list={listId}
            maxLength={TAG_MAX_LENGTH}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTyped(e.currentTarget);
              }
            }}
            onBlur={(e) => {
              addTyped(e.currentTarget);
            }}
          />
          <datalist id={listId}>
            {tagSuggestions(allTags, draft.tags).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>
      <div className={styles.field}>
        <label htmlFor={descId} className={styles.label}>
          Description
        </label>
        <textarea
          id={descId}
          className={styles.input}
          rows={3}
          maxLength={DESCRIPTION_MAX}
          placeholder="What this account posts and who it's for"
          value={draft.description}
          onChange={(e) => {
            update({ description: e.target.value });
          }}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.label} id={`${listId}-slots`}>
          Daily posting slots
        </span>
        <div className={styles.slots} role="group" aria-labelledby={`${listId}-slots`}>
          {draft.slots.map((s) => (
            <span key={s} className={styles.slot} data-slot={s}>
              {s}
              <button
                type="button"
                aria-label={`Remove slot ${s}`}
                onClick={() => {
                  update({ slots: draft.slots.filter((x) => x !== s) });
                }}
              >
                <X aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            className={styles.timeInput}
            type="time"
            aria-label="New slot time"
            value={slotInput}
            onChange={(e) => {
              setSlotInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTypedSlot();
              }
            }}
          />
          <button
            type="button"
            className={styles.linkBtn}
            disabled={draft.slots.length >= SLOTS_MAX}
            onClick={addTypedSlot}
          >
            <Plus aria-hidden="true" />
            Add slot
          </button>
        </div>
        <span className={styles.help}>
          {draft.slots.length === 0
            ? "Add at least one slot: the queue posts at these times every day."
            : "The queue posts at these times every day, in the workspace's time zone."}
        </span>
      </div>
    </>
  );
}
