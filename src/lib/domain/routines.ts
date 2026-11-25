/**
 * Routines (pure, ADR 0009): a time frame, how often to post, which accounts, and the rules the
 * planner follows. The posting schedule (one slot per post per account) is laid out here, before
 * anything is built; each slot's video starts `leadMinutes` before it posts.
 */
import { cleanGenre } from "./genres";
import { parseSlotTime } from "./slot-time";
import { addDays, toLocalDate, zonedTimeToUtc, type LocalDate } from "./time";

// ───────────────────────────── config (templates and routines) ─────────────────────────────

export interface RoutineReference {
  url: string;
  note: string;
}

export interface GenreShare {
  genre: string;
  /** Relative share: brainteaser 2 + explainer 3 → 40% / 60%. */
  weight: number;
}

/** The reusable part of a routine, saved as a template (routine_templates.config). */
export interface RoutineConfig {
  references: RoutineReference[];
  /** Style keys the planner may use; empty: any style. */
  styles: string[];
  genreMix: GenreShare[];
  /** Voice keys to use (rotated, so they can be compared); empty: any voice. */
  voices: string[];
  /** Music keys to use; empty: any track. */
  music: string[];
  useAvatar: boolean;
  avatarId: string | null;
  /** Free text for the planner: tone, topics, experiments ("test three hooks"). */
  rules: string;
}

export const EMPTY_CONFIG: RoutineConfig = {
  references: [],
  styles: [],
  genreMix: [],
  voices: [],
  music: [],
  useAvatar: false,
  avatarId: null,
  rules: "",
};

export const RULES_MAX = 4000;
export const REFERENCES_MAX = 10;
export const NOTE_MAX = 300;

function strings(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.trim() && !out.includes(v.trim())) out.push(v.trim());
  }
  return out.slice(0, max);
}

function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** A stored or submitted config, tidied: unknown fields dropped, every list bounded. */
export function parseConfig(value: unknown): RoutineConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_CONFIG };
  const v = value as Record<string, unknown>;
  const references: RoutineReference[] = [];
  if (Array.isArray(v.references)) {
    for (const r of v.references) {
      if (!r || typeof r !== "object") continue;
      const url =
        typeof (r as RoutineReference).url === "string" ? (r as RoutineReference).url.trim() : "";
      const note =
        typeof (r as RoutineReference).note === "string"
          ? (r as RoutineReference).note.trim().slice(0, NOTE_MAX)
          : "";
      if (isUrl(url) && !references.some((x) => x.url === url)) references.push({ url, note });
    }
  }
  const genreMix: GenreShare[] = [];
  if (Array.isArray(v.genreMix)) {
    for (const g of v.genreMix) {
      if (!g || typeof g !== "object") continue;
      const genre = cleanGenre((g as GenreShare).genre);
      const weight = Math.round(Number((g as { weight?: unknown }).weight));
      if (
        genre &&
        Number.isFinite(weight) &&
        weight > 0 &&
        !genreMix.some((x) => x.genre === genre)
      )
        genreMix.push({ genre, weight: Math.min(weight, 100) });
    }
  }
  return {
    references: references.slice(0, REFERENCES_MAX),
    styles: strings(v.styles),
    genreMix: genreMix.slice(0, 12),
    voices: strings(v.voices),
    music: strings(v.music),
    useAvatar: v.useAvatar === true,
    avatarId: typeof v.avatarId === "string" && v.avatarId ? v.avatarId : null,
    rules: typeof v.rules === "string" ? v.rules.trim().slice(0, RULES_MAX) : "",
  };
}

// ───────────────────────────── the posting schedule ─────────────────────────────

export type Approval = "auto" | "review";

export interface ScheduleInput {
  startsAt: Date;
  endsAt: Date;
  postsPerDay: number;
  /** "HH:MM" in the workspace timezone. */
  windowStart: string;
  /** "HH:MM", or "24:00" for the end of the day. */
  windowEnd: string;
  timezone: string;
  accountIds: readonly string[];
  leadMinutes: number;
}

export interface PlannedSlot {
  accountId: string;
  /** 1, 2, … over the whole routine, in posting order (accounts interleaved). */
  position: number;
  postAt: Date;
  buildAt: Date;
}

export const POSTS_PER_DAY_MAX = 48;
/** The most slots one routine may lay out (keeps a typo from planning 10 000 videos). */
export const SLOTS_MAX = 400;
/** Instagram's publishing limit is 50 posts per account per 24 h; leave room for other posts. */
export const QUOTA_PER_DAY = 25;
/** Times are rounded to 5 minutes. */
const ROUND_MIN = 5;

function windowMinutes(start: string, end: string): { from: number; to: number } | null {
  const from = parseSlotTime(start);
  const to = end === "24:00" ? 24 * 60 : parseSlotTime(end);
  if (from === null || to === null || to <= from) return null;
  return { from, to };
}

export interface ScheduleIssue {
  field: string;
  message: string;
}

/** What is wrong with a routine's timing, before any slot is laid out. */
export function scheduleIssues(input: ScheduleInput): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime()))
    issues.push({ field: "startsAt", message: "Pick when the routine starts and ends." });
  else if (input.endsAt <= input.startsAt)
    issues.push({ field: "endsAt", message: "The end must be after the start." });
  if (!Number.isInteger(input.postsPerDay) || input.postsPerDay < 1)
    issues.push({ field: "postsPerDay", message: "Post at least once a day." });
  else if (input.postsPerDay > QUOTA_PER_DAY)
    issues.push({
      field: "postsPerDay",
      message: `At most ${QUOTA_PER_DAY} posts a day per account (Instagram allows 50 in 24 hours, shared with every other post).`,
    });
  const w = windowMinutes(input.windowStart, input.windowEnd);
  if (!w)
    issues.push({ field: "windowEnd", message: "The daily window must end after it starts." });
  if (!input.accountIds.length)
    issues.push({ field: "accounts", message: "Pick at least one account." });
  if (issues.length === 0) {
    const n = layoutSlots(input).length;
    if (n === 0)
      issues.push({ field: "startsAt", message: "No post fits between the start and the end." });
    if (n > SLOTS_MAX)
      issues.push({
        field: "endsAt",
        message: `That is ${n} videos; a routine makes at most ${SLOTS_MAX}. Shorten it or split it.`,
      });
  }
  return issues;
}

/**
 * The posting schedule: on each local day of the time frame, `postsPerDay` times spread evenly
 * across the window (the first at its start), for every account; only times inside
 * [startsAt, endsAt). Accounts are interleaved so positions follow time.
 */
export function layoutSlots(input: ScheduleInput): PlannedSlot[] {
  const w = windowMinutes(input.windowStart, input.windowEnd);
  if (!w || input.postsPerDay < 1 || input.endsAt <= input.startsAt) return [];
  const step = (w.to - w.from) / input.postsPerDay;
  const offsets: number[] = [];
  for (let i = 0; i < input.postsPerDay; i++) {
    const m = Math.round((w.from + i * step) / ROUND_MIN) * ROUND_MIN;
    if (m < w.to && !offsets.includes(m)) offsets.push(m);
  }
  const times: Date[] = [];
  let day: LocalDate = toLocalDate(input.startsAt, input.timezone);
  const lastDay = toLocalDate(input.endsAt, input.timezone);
  for (let guard = 0; guard < 400; guard++) {
    for (const m of offsets) {
      const t = zonedTimeToUtc(day, m, input.timezone);
      if (t >= input.startsAt && t < input.endsAt) times.push(t);
    }
    if (day.year === lastDay.year && day.month === lastDay.month && day.day === lastDay.day) break;
    day = addDays(day, 1);
  }
  const out: PlannedSlot[] = [];
  for (const t of times) {
    for (const accountId of input.accountIds) {
      out.push({
        accountId,
        position: out.length + 1,
        postAt: t,
        buildAt: new Date(t.getTime() - input.leadMinutes * 60_000),
      });
    }
  }
  return out;
}

/** "Every 1 h 12 min" for a window and a number of posts a day. */
export function cadenceLabel(postsPerDay: number, windowStart: string, windowEnd: string): string {
  const w = windowMinutes(windowStart, windowEnd);
  if (!w || postsPerDay < 1) return "";
  if (postsPerDay === 1) return "Once a day";
  const every = Math.round((w.to - w.from) / postsPerDay);
  const h = Math.floor(every / 60);
  const m = every % 60;
  return `Every ${h ? `${h} h` : ""}${h && m ? " " : ""}${m ? `${m} min` : ""}`;
}

// ───────────────────────────── genre mix ─────────────────────────────

/** How many of `n` videos each genre gets (largest remainder), in mix order. */
export function mixCounts(mix: readonly GenreShare[], n: number): Map<string, number> {
  const out = new Map<string, number>();
  const total = mix.reduce((s, g) => s + g.weight, 0);
  if (!total || n <= 0) return out;
  const raw = mix.map((g) => ({ genre: g.genre, exact: (g.weight / total) * n }));
  let given = 0;
  for (const r of raw) {
    const c = Math.floor(r.exact);
    out.set(r.genre, c);
    given += c;
  }
  const order = [...raw].sort(
    (a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)),
  );
  for (let i = 0; given < n; i = (i + 1) % order.length, given++) {
    const g = order[i]?.genre;
    if (g === undefined) break;
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** The mix spread over `n` slots in turn (a, b, a, b, c …), so genres don't bunch up. */
export function genreSequence(mix: readonly GenreShare[], n: number): (string | null)[] {
  const counts = mixCounts(mix, n);
  if (!counts.size) return Array.from({ length: n }, () => null);
  const left = new Map(counts);
  const given = new Map<string, number>([...counts.keys()].map((g) => [g, 0]));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    // The genre furthest behind its share so far.
    let best: string | null = null;
    let bestLag = -Infinity;
    for (const [g, total] of counts) {
      if ((left.get(g) ?? 0) <= 0) continue;
      const lag = (total * (i + 1)) / n - (given.get(g) ?? 0);
      if (lag > bestLag) {
        bestLag = lag;
        best = g;
      }
    }
    if (best === null) break;
    const g = best;
    out.push(g);
    left.set(g, (left.get(g) ?? 0) - 1);
    given.set(g, (given.get(g) ?? 0) + 1);
  }
  return out;
}

// ───────────────────────────── duplicate ideas ─────────────────────────────

const STOP = new Set(
  "a an and are as at be by can do does for from how i in is it its of on or that the this to was what when where which who why will with you your".split(
    " ",
  ),
);

/** The words that carry an idea: lower case, no stop words, crude plural folding. */
export function ideaWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);
  }
  return out;
}

/** Jaccard overlap of two ideas' words (0–1). */
export function ideaSimilarity(a: string, b: string): number {
  const x = ideaWords(a);
  const y = ideaWords(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/** Above this the planner's idea counts as a repeat of an earlier video. */
export const DUPLICATE_SIMILARITY = 0.5;

export interface PastIdea {
  title: string;
  idea: string;
}

/** The earlier video an idea repeats (same title, or most words in common), or null. */
export function duplicateOf<T extends PastIdea>(idea: PastIdea, past: readonly T[]): T | null {
  const title = idea.title.trim().toLowerCase();
  let best: T | null = null;
  let bestScore = 0;
  for (const p of past) {
    if (title && p.title.trim().toLowerCase() === title) return p;
    const score = Math.max(
      ideaSimilarity(`${idea.title} ${idea.idea}`, `${p.title} ${p.idea}`),
      ideaSimilarity(idea.title, p.title),
    );
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= DUPLICATE_SIMILARITY ? best : null;
}

// ───────────────────────────── the plan (one brief per slot) ─────────────────────────────

export interface SlotBrief {
  title: string;
  idea: string;
  genre: string | null;
  hook: string;
  style: string;
  voiceKey: string;
  musicKey: string;
  /** Why this slot looks like this (the experiment it belongs to), shown on the plan. */
  notes: string;
}

export interface PlanLibraries {
  styles: readonly string[];
  voices: readonly string[];
  music: readonly string[];
}

export interface PlanIssue {
  slotId: string | null;
  message: string;
}

const TITLE_MAX = 120;
const IDEA_MAX = 1000;
const HOOK_MAX = 200;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** One submitted brief (snake_case from the planner API, or camelCase), tidied. */
export function parseBrief(value: unknown): SlotBrief | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const brief: SlotBrief = {
    title: str(v.title, TITLE_MAX),
    idea: typeof v.idea === "string" ? v.idea.trim().slice(0, IDEA_MAX) : "",
    genre: cleanGenre(typeof v.genre === "string" ? v.genre : null),
    hook: str(v.hook, HOOK_MAX),
    style: str(v.style, 60),
    voiceKey: str(v.voice_key ?? v.voiceKey, 60),
    musicKey: str(v.music_key ?? v.musicKey, 60),
    notes: str(v.notes, NOTE_MAX),
  };
  return brief;
}

/**
 * Checks a whole plan: every slot gets exactly one brief, each brief uses a style, voice and
 * track the routine allows, and no idea repeats an earlier video or another slot.
 */
export function planIssues(input: {
  slotIds: readonly string[];
  briefs: readonly { slotId: string; brief: SlotBrief | null }[];
  config: RoutineConfig;
  libraries: PlanLibraries;
  past: readonly PastIdea[];
}): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const known = new Set(input.slotIds);
  const seen = new Set<string>();
  const accepted: PastIdea[] = [];
  const allowed = (list: readonly string[], library: readonly string[]) =>
    list.length ? list.filter((k) => library.includes(k)) : library;
  const styles = allowed(input.config.styles, input.libraries.styles);
  const voices = allowed(input.config.voices, input.libraries.voices);
  const music = allowed(input.config.music, input.libraries.music);
  for (const { slotId, brief } of input.briefs) {
    if (!known.has(slotId)) {
      issues.push({ slotId, message: `Unknown slot ${slotId}.` });
      continue;
    }
    if (seen.has(slotId)) {
      issues.push({ slotId, message: "This slot has two briefs." });
      continue;
    }
    seen.add(slotId);
    if (!brief) {
      issues.push({ slotId, message: "The brief must be an object." });
      continue;
    }
    if (!brief.title) issues.push({ slotId, message: "title is required." });
    if (brief.idea.length < 20)
      issues.push({
        slotId,
        message: "idea must say what the video shows (20 characters or more).",
      });
    if (!styles.includes(brief.style))
      issues.push({
        slotId,
        message: `style "${brief.style}" isn't allowed. Use one of: ${styles.join(", ")}.`,
      });
    if (!voices.includes(brief.voiceKey))
      issues.push({
        slotId,
        message: `voice_key "${brief.voiceKey}" isn't allowed. Use one of: ${voices.join(", ")}.`,
      });
    if (!music.includes(brief.musicKey))
      issues.push({
        slotId,
        message: `music_key "${brief.musicKey}" isn't allowed. Use one of: ${music.join(", ")}.`,
      });
    if (
      input.config.genreMix.length &&
      brief.genre &&
      !input.config.genreMix.some((g) => g.genre === brief.genre)
    )
      issues.push({
        slotId,
        message: `genre "${brief.genre}" isn't in the mix (${input.config.genreMix.map((g) => g.genre).join(", ")}).`,
      });
    const earlier = duplicateOf(brief, input.past);
    if (earlier)
      issues.push({
        slotId,
        message: `Repeats an earlier video: "${earlier.title}". Pick a new idea.`,
      });
    const sibling = duplicateOf(brief, accepted);
    if (sibling)
      issues.push({ slotId, message: `Repeats another slot in this plan: "${sibling.title}".` });
    accepted.push(brief);
  }
  for (const id of input.slotIds) {
    if (!seen.has(id)) issues.push({ slotId: id, message: "This slot has no brief." });
  }
  return issues;
}

// ───────────────────────────── running ─────────────────────────────

export type RoutineStatus =
  "draft" | "planning" | "planned" | "running" | "paused" | "done" | "cancelled";
export type SlotStatus =
  | "open"
  | "planned"
  | "building"
  | "review"
  | "scheduled"
  | "posted"
  | "failed"
  | "missed"
  | "skipped";

export const FINAL_SLOT_STATUSES: readonly SlotStatus[] = ["posted", "failed", "missed", "skipped"];

export const SLOT_STATUS_LABELS: Record<SlotStatus, string> = {
  open: "Not planned",
  planned: "Planned",
  building: "Building",
  review: "Waiting for you",
  scheduled: "Scheduled",
  posted: "Posted",
  failed: "Failed",
  missed: "Missed",
  skipped: "Skipped",
};

export const ROUTINE_STATUS_LABELS: Record<RoutineStatus, string> = {
  draft: "Draft",
  planning: "Planning",
  planned: "Plan ready",
  running: "Running",
  paused: "Paused",
  done: "Done",
  cancelled: "Cancelled",
};

/** A finished video may still post this long after its slot; later it is missed. */
export const GRACE_MINUTES = 15;

export interface SlotState {
  id: string;
  status: SlotStatus;
  postAt: Date;
  buildAt: Date;
}

/** Slots whose time passed before their video was scheduled. */
export function missedSlots<T extends SlotState>(slots: readonly T[], now: Date): T[] {
  const cutoff = now.getTime() - GRACE_MINUTES * 60_000;
  return slots.filter(
    (s) =>
      (s.status === "planned" || s.status === "building" || s.status === "review") &&
      s.postAt.getTime() < cutoff,
  );
}

/**
 * The slots to start building now: planned, due (build time reached), earliest post first, as
 * many as fit beside the ones already building. A slot within its grace time is still started
 * only if it can't be missed yet.
 */
export function slotsToStart<T extends SlotState>(input: {
  slots: readonly T[];
  now: Date;
  maxParallel: number;
}): T[] {
  const building = input.slots.filter((s) => s.status === "building").length;
  const room = Math.max(0, input.maxParallel - building);
  if (!room) return [];
  const cutoff = input.now.getTime() - GRACE_MINUTES * 60_000;
  return input.slots
    .filter((s) => s.status === "planned" && s.buildAt <= input.now && s.postAt.getTime() >= cutoff)
    .sort((a, b) => a.postAt.getTime() - b.postAt.getTime())
    .slice(0, room);
}

/** Whether a routine has nothing left to do. */
export function routineFinished(slots: readonly { status: SlotStatus }[]): boolean {
  return slots.length > 0 && slots.every((s) => FINAL_SLOT_STATUSES.includes(s.status));
}

/** Where a finished video goes: at its slot, now (inside the grace time), or nowhere (missed). */
export function postTimeFor(postAt: Date, now: Date): Date | null {
  if (postAt > now) return postAt;
  if (now.getTime() - postAt.getTime() <= GRACE_MINUTES * 60_000) return now;
  return null;
}

/** Counts by status, for the list and the summary line. */
export function slotCounts(slots: readonly { status: SlotStatus }[]): Record<SlotStatus, number> {
  const out = Object.fromEntries(Object.keys(SLOT_STATUS_LABELS).map((k) => [k, 0])) as Record<
    SlotStatus,
    number
  >;
  for (const s of slots) out[s.status]++;
  return out;
}

// ───────────────────────────── the Sandbox planner ─────────────────────────────

interface BankEntry {
  title: string;
  idea: string;
  hook: string;
}
type Bank = readonly [BankEntry, ...BankEntry[]];

const IDEA_BANK: Record<string, Bank> = {
  explainer: [
    {
      title: "Why the sky is blue",
      idea: "Sunlight scatters off air molecules; blue light scatters most, so the whole sky glows blue while sunsets turn red.",
      hook: "The sky isn't blue. Your eyes are just picky.",
    },
    {
      title: "How noise cancelling works",
      idea: "Headphones record outside sound and play its mirror wave, so the two cancel out before they reach your ear.",
      hook: "Your headphones fight sound with sound.",
    },
    {
      title: "Why ice floats",
      idea: "Water molecules lock into an open hexagon when they freeze, so ice is less dense than the water beneath it.",
      hook: "Almost every solid sinks. Ice doesn't.",
    },
    {
      title: "How GPS knows where you are",
      idea: "Your phone times signals from four satellites; the tiny delays pin your position to a few metres, after correcting for relativity.",
      hook: "Einstein is the reason your map works.",
    },
    {
      title: "Why cats always land on their feet",
      idea: "A cat twists its front and back halves in turn, using its flexible spine to rotate mid-air without pushing off anything.",
      hook: "Cats break a rule of physics. Almost.",
    },
  ],
  brainteaser: [
    {
      title: "The two doors riddle",
      idea: "Two guards, one always lies, one always tells the truth; one question picks the safe door. Pause, then reveal the answer.",
      hook: "You get one question. Make it count.",
    },
    {
      title: "The missing dollar",
      idea: "Three guests pay $30, get $5 back, the porter keeps $2: where did the dollar go? Show why the sum is a trick.",
      hook: "A dollar disappears. Or does it?",
    },
    {
      title: "The bat and the ball",
      idea: "A bat and ball cost $1.10; the bat costs $1 more than the ball. Most people say 10 cents. Reveal 5 cents.",
      hook: "90% of people get this wrong.",
    },
    {
      title: "Four 4s make 7",
      idea: "Use exactly four 4s and any operations to make 7; give three seconds to think, then show 44 ÷ 4 − 4.",
      hook: "Four fours. Make seven. Go.",
    },
    {
      title: "The burning ropes",
      idea: "Two ropes each burn in an hour, unevenly; measure 45 minutes by lighting the ends in the right order.",
      hook: "Time 45 minutes with two ropes and a lighter.",
    },
  ],
  "myth-buster": [
    {
      title: "Do we only use 10% of our brain?",
      idea: "Brain scans show nearly every region active over a day; the 10% figure comes from a misquoted early study.",
      hook: "You've been told you use 10% of your brain.",
    },
    {
      title: "Does lightning never strike twice?",
      idea: "Tall buildings are hit dozens of times a year; lightning prefers the same high points again and again.",
      hook: "Lightning loves a repeat.",
    },
  ],
  list: [
    {
      title: "Three apps that save you an hour a day",
      idea: "A trip planner, a read-later app and a focus timer, each shown in five seconds of real use.",
      hook: "Three apps. One extra hour.",
    },
    {
      title: "Four facts about octopuses",
      idea: "Three hearts, blue blood, arms that think on their own and skin that sees light: one quick beat each.",
      hook: "Octopuses are basically aliens.",
    },
  ],
};

const DEFAULT_BANK: Bank = IDEA_BANK.explainer ?? [
  { title: "A new idea", idea: "Something worth explaining.", hook: "" },
];

function bankFor(genre: string | null): Bank {
  return IDEA_BANK[genre ?? ""] ?? DEFAULT_BANK;
}

/**
 * The Sandbox's planner: what a planner session would post, at once, with no session. Follows
 * the genre mix, rotates voices, styles and music, and never repeats a past idea.
 */
export function fakePlan(input: {
  slotIds: readonly string[];
  config: RoutineConfig;
  libraries: PlanLibraries;
  past: readonly PastIdea[];
}): { slotId: string; brief: SlotBrief }[] {
  const pick = (list: readonly string[], library: readonly string[]) => {
    const l = list.length ? list.filter((k) => library.includes(k)) : library;
    return l.length ? l : library;
  };
  const styles = pick(input.config.styles, input.libraries.styles);
  const voices = pick(input.config.voices, input.libraries.voices);
  const music = pick(input.config.music, input.libraries.music);
  const genres = genreSequence(input.config.genreMix, input.slotIds.length);
  const used: PastIdea[] = [...input.past];
  const counters = new Map<string, number>();
  return input.slotIds.map((slotId, i) => {
    const genre = genres[i] ?? (input.config.genreMix.length ? null : "explainer");
    const bank = bankFor(genre);
    const n = counters.get(genre ?? "") ?? 0;
    let chosen = bank.find((b) => !duplicateOf(b, used));
    let title = chosen?.title;
    if (!chosen) {
      chosen = bank[n % bank.length] ?? bank[0];
      title = `${chosen.title} (part ${Math.floor(n / bank.length) + 2})`;
    }
    counters.set(genre ?? "", n + 1);
    const brief: SlotBrief = {
      title: title ?? chosen.title,
      idea:
        title === chosen.title
          ? chosen.idea
          : `${chosen.idea} A new angle: part ${Math.floor(n / bank.length) + 2}.`,
      genre,
      hook: chosen.hook,
      style: styles[i % styles.length] ?? "",
      voiceKey: voices[i % voices.length] ?? "",
      musicKey: music[i % music.length] ?? "",
      notes: voices.length > 1 ? `Voice test: ${voices[i % voices.length]}.` : "",
    };
    used.push(brief);
    return { slotId, brief };
  });
}

// ───────────────────────────── a slot's build ─────────────────────────────

/** How many times a routine redoes a video on its own before giving up on the slot. */
export const MAX_RETRIES = 1;

export interface SelfReview {
  passed: boolean;
  notes: string[];
}

/** The session's own check of its render (`output.review`), or null when it sent none. */
export function parseReview(value: unknown): SelfReview | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.passed !== "boolean") return null;
  const notes = Array.isArray(v.notes)
    ? v.notes
        .filter((n): n is string => typeof n === "string")
        .map((n) => n.slice(0, 300))
        .slice(0, 10)
    : [];
  return { passed: v.passed, notes };
}

export type BuildNext =
  | { kind: "wait"; message: string | null }
  | { kind: "retry"; step: string; note: string }
  | { kind: "fail"; message: string }
  | { kind: "finish" }
  | { kind: "scheduled" };

/**
 * What a building slot does next, from its video's state: keep waiting, redo (once) after a
 * failed step or a failed self-review, give up, or finish (cover, caption, checks, schedule).
 */
export function nextForBuild(input: {
  productionStatus: "draft" | "running" | "waiting" | "ready" | "scheduled" | "failed";
  failedStep: { step: string; message: string | null } | null;
  waitingStep: { step: string; message: string | null } | null;
  review: SelfReview | null;
  retries: number;
}): BuildNext {
  const canRetry = input.retries < MAX_RETRIES;
  switch (input.productionStatus) {
    case "scheduled":
      return { kind: "scheduled" };
    case "failed": {
      const f = input.failedStep;
      const why = f?.message ?? "a step failed";
      if (canRetry && f)
        return { kind: "retry", step: f.step, note: `Automatic retry after: ${why}`.slice(0, 500) };
      return {
        kind: "fail",
        message: `The video failed at ${f?.step ?? "a step"}: ${why}`.slice(0, 1000),
      };
    }
    case "waiting": {
      const w = input.waitingStep;
      return {
        kind: "wait",
        message: `Waiting at ${w?.step ?? "a step"}: ${w?.message ?? "needs you on the video's page"}`,
      };
    }
    case "ready": {
      if (input.review && !input.review.passed) {
        const notes = input.review.notes.join(" ") || "the session's own check failed";
        if (canRetry)
          return {
            kind: "retry",
            step: "render",
            note: `Fix what your check found: ${notes}`.slice(0, 500),
          };
        return { kind: "fail", message: `Failed its own check twice: ${notes}`.slice(0, 1000) };
      }
      return { kind: "finish" };
    }
    default:
      return { kind: "wait", message: null };
  }
}

// ───────────────────────────── form values ─────────────────────────────

/** A `datetime-local` value ("2026-11-26T09:00") for an instant, in the workspace timezone. */
export function toLocalInput(instant: Date, timezone: string): string {
  const d = toLocalDate(instant, timezone);
  const midnight = zonedTimeToUtc(d, 0, timezone);
  let minutes = Math.round((instant.getTime() - midnight.getTime()) / 60_000);
  minutes = Math.max(0, Math.min(24 * 60 - 1, minutes));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.year}-${pad(d.month)}-${pad(d.day)}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The instant a `datetime-local` value means in the workspace timezone, or null. */
export function fromLocalInput(value: string, timezone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return zonedTimeToUtc({ year: y, month: mo, day: d }, h * 60 + mi, timezone);
}
