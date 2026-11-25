/**
 * The studio list (BC-42, pure): what each video's card says and which filters it falls under,
 * so the grid shows at a glance what needs Matthew.
 */

export type ListFilter = "all" | "needs_me" | "in_progress" | "scheduled" | "posted";

export const LIST_FILTERS: readonly { key: ListFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_me", label: "Needs me" },
  { key: "in_progress", label: "In progress" },
  { key: "scheduled", label: "Scheduled" },
  { key: "posted", label: "Posted" },
];

export interface ListFacts {
  /** productions.status */
  status: string;
  /** The newest version's number, or null before the first render. */
  newestVersion: number | null;
  /** Notes still with Matthew or Claude (draft or sent). */
  openNotes: number;
  /** Answered notes Matthew hasn't resolved yet. */
  answersToRead: number;
  /** A batch of notes is with Claude. */
  batchOpen: boolean;
  /** A delivery pack is marked ready (and nothing is queued yet). */
  readyPack: boolean;
  /** The video's post, if queued or published. */
  post: { status: string; when: string } | null;
  /** The label of the step waiting or running, e.g. "Script". */
  stepLabel: string | null;
}

const QUEUED = new Set(["queued", "publishing", "paused"]);

/** One line under the title: "v3, 2 notes open", "ready to post", "scheduled for Tue 18:00"… */
export function cardLine(f: ListFacts): string {
  if (f.post?.status === "published") return `Posted ${midSentence(f.post.when)}`;
  if (f.post && QUEUED.has(f.post.status)) return `Scheduled for ${midSentence(f.post.when)}`;
  if (f.readyPack) return "Ready to post";
  if (f.newestVersion !== null) {
    const v = `v${f.newestVersion}`;
    // A step that needs Matthew (or failed) matters more than the notes.
    if (f.status === "failed" && f.stepLabel) return `${v}, ${f.stepLabel.toLowerCase()} failed`;
    if (f.status === "waiting" && f.stepLabel)
      return `${v}, ${f.stepLabel.toLowerCase()} waits for you`;
    if (f.answersToRead) return `${v}, ${plural(f.answersToRead, "answer")} to read`;
    if (f.openNotes) return `${v}, ${plural(f.openNotes, "note")} open`;
    return v;
  }
  if (f.status === "draft") return "Draft: not started";
  if (f.status === "failed") return f.stepLabel ? `${f.stepLabel} failed` : "Failed";
  if (f.status === "waiting")
    return f.stepLabel ? `${f.stepLabel} waits for you` : "Waiting for you";
  return f.stepLabel ? `${f.stepLabel} in progress` : "In progress";
}

/** "Today, 18:00" → "today, 18:00" after other words (sentence case); weekdays keep their capital. */
function midSentence(when: string): string {
  return when.replace(/^(Today|Tomorrow|Yesterday)\b/, (w) => w.toLowerCase());
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Whether a video belongs under a filter. */
export function inFilter(filter: ListFilter, f: ListFacts): boolean {
  const queued = Boolean(f.post && QUEUED.has(f.post.status));
  const posted = f.post?.status === "published";
  switch (filter) {
    case "all":
      return true;
    case "needs_me":
      // A step waits or failed, answers wait to be read, or a finished video isn't scheduled.
      return (
        !queued &&
        !posted &&
        (f.status === "waiting" ||
          f.status === "failed" ||
          f.status === "ready" ||
          f.answersToRead > 0 ||
          f.readyPack)
      );
    case "in_progress":
      return !queued && !posted && (f.status === "running" || f.batchOpen);
    case "scheduled":
      return queued;
    case "posted":
      return posted;
  }
}
