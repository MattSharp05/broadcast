import type { FactoryStep } from "./steps";

/**
 * The studio's activity feed (BC-36): one-line intents from sessions ("what and why"), Matthew's
 * actions and the system's housekeeping, stored in `production_events`.
 */

export const INTENT_MAX = 160;

export type EventActor = "session" | "matthew" | "system";

/** An intent as stored: one line, at most 160 characters (longer is cut, with an ellipsis). */
export function clipIntent(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const line = raw.replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > INTENT_MAX ? `${line.slice(0, INTENT_MAX - 1)}…` : line;
}

/** What the fake runner says it is doing at each step (Sandbox, scenarios, e2e). */
export const FAKE_INTENTS: Record<FactoryStep | "revise", string> = {
  idea: "Turning the idea into a one-line brief and a hook that stops the scroll.",
  script: "Writing five short lines, the surprising fact first.",
  style: "Making one frame of the hook beat in the chosen style.",
  visuals: "Drawing a still for each scene so the board reads end to end.",
  face_quote: "Pricing the three avatar cut-ins before anything is paid.",
  render: "Rendering the film and measuring its loudness.",
  revise: "Answering each note on the frame it points at, then rendering a new version.",
};

/** The fake runner's reply to a note (canned, numbered so each note gets its own). */
export function fakeReply(number: number, text: string): string {
  const quoted = text.replace(/\s+/g, " ").trim().slice(0, 80);
  return `Note ${number}: done. Changed what you asked (“${quoted}”) and kept everything else.`;
}
