/**
 * Video genres (pure): what kind of video it is, set by a routine's planner or by hand on the
 * video page. Any short label is allowed; these are the ones suggested and used by routine mixes.
 */

export const GENRE_MAX_LENGTH = 40;

export const SUGGESTED_GENRES: readonly { key: string; label: string; help: string }[] = [
  { key: "explainer", label: "Explainer", help: "How or why something works, in under a minute." },
  { key: "brainteaser", label: "Brainteaser", help: "A puzzle the viewer tries to solve first." },
  { key: "myth-buster", label: "Myth buster", help: "A common belief, then what is true." },
  { key: "list", label: "List", help: "Three to five quick facts on one topic." },
  { key: "story", label: "Story", help: "A short true story with a twist." },
  { key: "tutorial", label: "Tutorial", help: "Step by step: do this, then this." },
  { key: "comparison", label: "Comparison", help: "A vs B, with a verdict." },
  { key: "news", label: "News", help: "Something that just happened, explained." },
];

/** A genre tidied up: lower case, spaces as dashes, cut to GENRE_MAX_LENGTH. Empty → null. */
export function cleanGenre(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const g = raw
    .toLowerCase()
    .replace(/[^a-z0-9 -]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, GENRE_MAX_LENGTH)
    .replace(/^-+|-+$/g, "");
  return g === "" ? null : g;
}

/** "brainteaser" → "Brainteaser"; an unknown "deep-dive" → "Deep dive". */
export function genreLabel(genre: string | null | undefined): string {
  if (!genre) return "";
  const known = SUGGESTED_GENRES.find((g) => g.key === genre);
  if (known) return known.label;
  const words = genre.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
