/**
 * Captions (pure): the credit lines a video needs, and the caption options built around them.
 * Music must be baked into the video (Instagram's library isn't available through the API), so a
 * CC BY track always needs its credit in the caption; AI voices and avatars are disclosed.
 */

export const CAPTION_MAX = 2200;

export interface CreditInput {
  musicCredit: string | null;
  musicLicence: string | null;
  voiceCredit: string | null;
  avatar: boolean;
  /** Imagery credits the session reported (NASA, Wikimedia CC BY-SA…). */
  imagery: readonly string[];
}

export function creditLines(input: CreditInput): string[] {
  const lines: string[] = [];
  if (input.musicCredit && input.musicLicence !== "CC0") lines.push(input.musicCredit);
  if (input.voiceCredit) lines.push(input.voiceCredit);
  if (input.avatar) lines.push("Presenter: AI-generated avatar.");
  for (const credit of input.imagery) {
    const c = credit.trim();
    if (c && !lines.includes(c)) lines.push(c);
  }
  return lines;
}

/** A caption with its credit block after a blank line; credits already present aren't repeated. */
export function withCredits(body: string, credits: readonly string[]): string {
  const text = body.trim();
  const missing = credits.filter((c) => !text.includes(c));
  if (!missing.length) return text;
  // A credit block already there: add to it; else start one after a blank line.
  const hasBlock = credits.some((c) => text.includes(c));
  return `${text}${hasBlock ? "\n" : "\n\n"}${missing.join("\n")}`;
}

export interface CaptionInput {
  title: string;
  idea: string;
  hook: string | null;
  credits: readonly string[];
}

/**
 * Three starting options (hook-led, question-led, plain summary). A session can post better ones
 * (POST checkpoint `caption_options`); these keep the free path working without one.
 */
export function draftCaptions(input: CaptionInput): string[] {
  const topic = (input.title || input.idea).trim().replace(/\s+/g, " ");
  const hook = (input.hook ?? "").trim();
  const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
  const options = [
    hook ? `${sentence(hook)} ${sentence(capitalise(topic))}` : sentence(capitalise(topic)),
    `Ever wondered ${lowerFirst(topic).replace(/[.?!]$/, "")}? Here it is in a minute.`,
    `${sentence(capitalise(topic))} Save this for later.`,
  ];
  return options.map((o) => withCredits(o, input.credits).slice(0, CAPTION_MAX));
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
