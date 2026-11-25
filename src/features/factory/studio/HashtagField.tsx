"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { HASHTAGS_MAX, addHashtags } from "@/lib/domain/factory/delivery";
import styles from "./studio.module.css";

/**
 * Hashtags as chips: type and press Enter, space or comma (the # is added for you); at most 30.
 * They are added to the end of the caption when the post goes out.
 */
export function HashtagField({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const commit = () => {
    if (!typed.trim()) return;
    onChange(addHashtags(value, typed).slice(0, HASHTAGS_MAX));
    setTyped("");
  };
  return (
    <div className={styles.field}>
      <label htmlFor="hashtags">
        Hashtags{" "}
        <span className={styles.meta}>
          ({value.length} of {HASHTAGS_MAX})
        </span>
      </label>
      <div className={styles.chips} data-testid="hashtags">
        {value.map((tag) => (
          <span key={tag} className={styles.chip}>
            #{tag}
            <button
              type="button"
              aria-label={`Remove #${tag}`}
              disabled={disabled}
              onClick={() => {
                onChange(value.filter((t) => t !== tag));
              }}
            >
              <X aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id="hashtags"
          className={styles.chipInput}
          value={typed}
          disabled={(disabled ?? false) || value.length >= HASHTAGS_MAX}
          placeholder={value.length ? "" : "tides, moon, science"}
          onChange={(e) => {
            const v = e.target.value;
            if (/[\s,]$/.test(v)) {
              onChange(addHashtags(value, v).slice(0, HASHTAGS_MAX));
              setTyped("");
            } else setTyped(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !typed && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={commit}
        />
      </div>
    </div>
  );
}
