"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { platformName } from "@/components/PlatformGlyph";
import { StatusDot, type StatusTone } from "@/components/StatusDot";
import { Tag } from "@/components/Tag";
import {
  STATUS_LABELS,
  cleanDescription,
  followersLabel,
  shortReason,
  type AccountRow,
} from "@/lib/domain/accounts";
import type { AccountState } from "@/lib/domain/canvas";
import { addTag, removeTag, tagSuggestions } from "@/lib/domain/tags";
import styles from "./accounts.module.css";
import type { AccountsActions } from "./actions";

const TONES: Record<AccountState, StatusTone> = {
  ready: "good",
  needs_attention: "warn",
  not_connected: "neutral",
};

/** Autosave delay after the last keystroke. */
export const DESCRIPTION_SAVE_MS = 500;
const SAVED_SHOWN_MS = 1400;

interface RowProps {
  account: AccountRow;
  /** Every tag in use (suggestions when adding one). */
  allTags: readonly string[];
  onTags: (accountId: string, tags: string[]) => void;
  onDescription: AccountsActions["updateAccountDescription"];
  onError: (message: string) => void;
  /** Opens the account drawer (BC-15); the button is disabled without it. */
  onDetails?: (accountId: string, opener: HTMLElement) => void;
}

function TagsCell({ account, allTags, onTags }: Pick<RowProps, "account" | "allTags" | "onTags">) {
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const listId = `tag-suggestions-${account.id}`;

  useEffect(() => {
    if (!adding && refocus.current) {
      refocus.current = false;
      addButton.current?.focus();
    }
  }, [adding]);

  // Enter/Escape unmount the input, which can fire a late blur: handle only the first.
  const done = useRef(false);
  const finish = (input: HTMLInputElement, save: boolean, keepFocus: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = save ? addTag(account.tags, input.value, allTags) : null;
    refocus.current = keepFocus;
    setAdding(false);
    if (next) onTags(account.id, next);
  };

  return (
    <div className={styles.tags}>
      {account.tags.map((t) => (
        <Tag
          key={t}
          label={t}
          onRemove={() => {
            onTags(account.id, removeTag(account.tags, t));
          }}
        />
      ))}
      {adding ? (
        <>
          <input
            className={styles.tagInput}
            placeholder="Tag name"
            aria-label={`New tag for @${account.handle}`}
            list={listId}
            autoFocus
            maxLength={40}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                finish(e.currentTarget, true, true);
              } else if (e.key === "Escape") {
                e.preventDefault();
                finish(e.currentTarget, false, true);
              }
            }}
            onBlur={(e) => {
              finish(e.currentTarget, true, false);
            }}
          />
          <datalist id={listId}>
            {tagSuggestions(allTags, account.tags).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </>
      ) : (
        <button
          ref={addButton}
          type="button"
          className={styles.addTag}
          aria-label={`Add tag to @${account.handle}`}
          onClick={() => {
            done.current = false;
            setAdding(true);
          }}
        >
          Add tag
        </button>
      )}
    </div>
  );
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function DescriptionCell({
  account,
  onDescription,
  onError,
}: Pick<RowProps, "account" | "onDescription" | "onError">) {
  const [value, setValue] = useState(account.description);
  const [saved, setSaved] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSaved = useRef(account.description);
  const latest = useRef({ value, accountId: account.id, onDescription, onError });
  latest.current = { value, accountId: account.id, onDescription, onError };

  // A fresh value from the server (another tab, a reload) replaces ours unless we're editing.
  const [seen, setSeen] = useState(account.description);
  if (seen !== account.description) {
    setSeen(account.description);
    if (document.activeElement !== ref.current && timer.current === undefined) {
      setValue(account.description);
      lastSaved.current = account.description;
    }
  }

  useLayoutEffect(() => {
    autosize(ref.current);
  }, [value]);

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const { value: v, accountId, onDescription: save, onError: fail } = latest.current;
    const clean = cleanDescription(v);
    if (clean === lastSaved.current) return;
    lastSaved.current = clean;
    void save(accountId, clean).then((res) => {
      if (!res.ok) {
        lastSaved.current = "\u0000"; // unknown: the next edit saves again
        fail(res.error);
        return;
      }
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => {
        setSaved(false);
      }, SAVED_SHOWN_MS);
    });
  };

  // Save what's pending when the row goes away (filtered out, tab left).
  useEffect(
    () => () => {
      clearTimeout(savedTimer.current);
      if (timer.current !== undefined) flush();
    },
    [],
  );

  return (
    <>
      <textarea
        ref={ref}
        className={styles.desc}
        rows={1}
        maxLength={1000}
        aria-label={`Description for @${account.handle}`}
        placeholder="What this account posts and who it's for"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, DESCRIPTION_SAVE_MS);
        }}
        onBlur={() => {
          if (timer.current !== undefined) flush();
        }}
      />
      <span className={styles.saved} data-on={saved ? "" : undefined} aria-live="polite">
        {saved ? "Saved" : ""}
      </span>
    </>
  );
}

/** One account row: who, status, inline tags and description, numbers, Details. */
export function AccountRowView({
  account,
  allTags,
  onTags,
  onDescription,
  onError,
  onDetails,
}: RowProps) {
  const reason = shortReason(account.statusReason);
  return (
    <tr className={styles.row} data-account={account.handle}>
      <td>
        <div className={styles.who}>
          <Avatar
            handle={account.handle}
            platform={account.platform}
            colour={account.avatar}
            size={32}
          />
          <div className={styles.whoText}>
            <a
              className={styles.handle}
              href={account.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              @{account.handle}
            </a>
            <div className={styles.small}>{platformName(account.platform)}</div>
          </div>
        </div>
      </td>
      <td>
        <StatusDot tone={TONES[account.status]}>{STATUS_LABELS[account.status]}</StatusDot>
        {reason ? (
          <div className={styles.small} title={account.statusReason ?? undefined}>
            {reason}
          </div>
        ) : null}
      </td>
      <td>
        <TagsCell account={account} allTags={allTags} onTags={onTags} />
      </td>
      <td>
        <DescriptionCell account={account} onDescription={onDescription} onError={onError} />
      </td>
      <td className={styles.num}>{followersLabel(account.followers)}</td>
      <td className={styles.num}>{account.slotsPerDay}</td>
      <td className={styles.num}>{account.backlog}</td>
      <td>
        {onDetails ? (
          <Button
            variant="ghost"
            className={styles.details}
            aria-haspopup="dialog"
            aria-label={`Details for @${account.handle}`}
            onClick={(e) => {
              onDetails(account.id, e.currentTarget);
            }}
          >
            Details
          </Button>
        ) : (
          <span title="Account details arrive soon.">
            <Button variant="ghost" className={styles.details} disabled>
              Details
            </Button>
          </span>
        )}
      </td>
    </tr>
  );
}
