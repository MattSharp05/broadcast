"use client";

import { useState } from "react";
import { Tag } from "@/components/Tag";
import type { VideoPatch } from "@/app/(app)/factory/actions";
import { SUGGESTED_GENRES, cleanGenre, genreLabel } from "@/lib/domain/genres";
import { addTag, removeTag } from "@/lib/domain/tags";
import styles from "./factory.module.css";

/**
 * The video's genre and campaign tags (the Posts tab filters and sorts on both). Saved at once,
 * at any stage: they describe the video, they don't change it.
 */
export function GenreTagsField({
  genre,
  tags,
  save,
  pending,
}: {
  genre: string | null;
  tags: string[];
  save: (patch: VideoPatch) => void;
  pending: boolean;
}) {
  const [genreText, setGenreText] = useState(genreLabel(genre));
  const [tagText, setTagText] = useState("");

  const saveGenre = () => {
    const next = cleanGenre(genreText);
    if (next === genre) return;
    save({ genre: next });
    setGenreText(genreLabel(next));
  };
  const addTyped = () => {
    const next = addTag(tags, tagText);
    setTagText("");
    if (next) save({ tags: next });
  };

  return (
    <div className={styles.row} data-testid="genre-tags">
      <label className={`${styles.field} ${styles.genreField}`}>
        Genre
        <input
          className={styles.input}
          list="factory-genres"
          value={genreText}
          placeholder="Explainer"
          maxLength={40}
          disabled={pending}
          onChange={(e) => {
            setGenreText(e.target.value);
          }}
          onBlur={saveGenre}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveGenre();
          }}
        />
        <datalist id="factory-genres">
          {SUGGESTED_GENRES.map((g) => (
            <option key={g.key} value={g.label} />
          ))}
        </datalist>
      </label>
      <div className={styles.field}>
        <span id="video-tags-label">Tags</span>
        <div className={styles.row} role="group" aria-labelledby="video-tags-label">
          {tags.map((t) => (
            <Tag
              key={t}
              label={t}
              onRemove={
                pending
                  ? undefined
                  : () => {
                      save({ tags: removeTag(tags, t) });
                    }
              }
            />
          ))}
          <input
            className={`${styles.input} ${styles.tagAdd}`}
            aria-label="Add a tag"
            placeholder="Add a tag, e.g. Trip"
            value={tagText}
            maxLength={40}
            disabled={pending}
            onChange={(e) => {
              setTagText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTyped();
            }}
            onBlur={() => {
              if (tagText.trim()) addTyped();
            }}
          />
        </div>
      </div>
    </div>
  );
}
