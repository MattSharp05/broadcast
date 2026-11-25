/**
 * The storyboard (BC-40, pure): cards of what happens or is said, how long, and a still, approved
 * before the build. A session may send its own cards with the visuals step; otherwise they are
 * estimated from the stills and the script.
 */

export const CARD_TEXT_MAX = 280;
/** Speech rate for estimated card lengths (words per second, a calm explainer read). */
export const WORDS_PER_S = 2.5;

export interface BoardCardInput {
  scene: string | null;
  text: string;
  seconds: number;
  still: string | null;
  /** True when the seconds were estimated, not sent by the session. */
  estimated?: boolean;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const half = (n: number) => Math.min(SECONDS_MAX, Math.max(0.5, Math.round(n * 2) / 2));

/** A card's length as stored (numeric(6,2), > 0): rounded to 0.01 s, within 0.01–600. */
export const SECONDS_MAX = 600;
export function cardSeconds(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const s = Math.round(raw * 100) / 100;
  return s >= 0.01 && s <= SECONDS_MAX ? s : null;
}

/** An estimated card's text says so (within the 280 characters). */
export function estimatedText(text: string): string {
  const mark = " (estimated)";
  const body = text.trim();
  return body
    ? `${body.slice(0, CARD_TEXT_MAX - mark.length)}${mark}`
    : "Estimated from the stills";
}

/**
 * Cards from the visuals stills when the session sent none: text = the still's caption, seconds =
 * that scene's share of the script (its lines split evenly across the stills, in order, timed at
 * the speech rate), labelled estimated. Without a script, the stills share `fallbackS` equally.
 */
export function estimateCards(
  stills: readonly { url: string; scene: string; caption: string }[],
  lines: readonly { text: string }[],
  fallbackS = 60,
): BoardCardInput[] {
  const n = stills.length;
  if (!n) return [];
  const per = lines.length ? lines.map((l) => words(l.text) / WORDS_PER_S) : [];
  return stills.map((s, i) => {
    let seconds: number;
    if (per.length) {
      const from = Math.floor((i * per.length) / n);
      const to = Math.max(from + 1, Math.floor(((i + 1) * per.length) / n));
      seconds = per.slice(from, to).reduce((a, b) => a + b, 0);
    } else seconds = fallbackS / n;
    return {
      scene: s.scene,
      text: s.caption.slice(0, CARD_TEXT_MAX),
      seconds: half(seconds),
      still: s.url,
      estimated: true,
    };
  });
}

/** Cards a session sent (`visuals.output.cards`), cleaned; invalid ones are dropped. */
export function parseCards(raw: unknown): BoardCardInput[] | null {
  if (!Array.isArray(raw)) return null;
  const cards: BoardCardInput[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const seconds = cardSeconds(o.seconds);
    if (seconds === null) continue;
    cards.push({
      scene: typeof o.scene === "string" ? o.scene.slice(0, 40) : null,
      text: typeof o.text === "string" ? o.text.slice(0, CARD_TEXT_MAX) : "",
      seconds,
      still: typeof o.still === "string" ? o.still : null,
    });
  }
  return cards.length ? cards : null;
}

/** Moves the item at `from` to `to`; positions stay 0…n−1 with no gaps. */
export function reorder<T extends { id: string }>(
  items: readonly T[],
  from: number,
  to: number,
): (T & { position: number })[] {
  const list = [...items];
  if (from < 0 || from >= list.length) return list.map((c, i) => ({ ...c, position: i }));
  const [moved] = list.splice(from, 1);
  const at = Math.max(0, Math.min(list.length, to));
  if (moved) list.splice(at, 0, moved);
  return list.map((c, i) => ({ ...c, position: i }));
}

/** Total length of the board, in seconds. */
export function boardSeconds(cards: readonly { seconds: number }[]): number {
  return Math.round(cards.reduce((a, c) => a + c.seconds, 0) * 10) / 10;
}
