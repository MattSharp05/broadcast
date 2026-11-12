import { estimateFaceClips, type Estimate, type SlotPlan } from "./budget";
import type { ScriptLine } from "./rework";
import type { FactoryStep } from "./steps";
import { stylePack } from "./styles";

/**
 * Canned checkpoint outputs for the fake runner (Sandbox, scenarios, e2e): what a Claude session
 * would post for each step, deterministic, with no session and no money. The shapes are the
 * factory API's (docs/factory-api.md).
 */

export interface IdeaOutput {
  title: string;
  brief: string;
  audience: string;
  hook: string;
}
export interface ScriptOutput {
  version: number;
  hook: string;
  lines: ScriptLine[];
}
export interface FramesOutput {
  frames: { url: string; caption: string }[];
}
export interface StillsOutput {
  stills: { url: string; scene: string; caption: string }[];
}
export interface QuoteOutput {
  model: string;
  slots: SlotPlan[];
  quote: Estimate;
}
export interface RenderOutput {
  duration_s: number;
  face_share: number | null;
  imagery_credits: string[];
  /** Set by the server once the upload is stored. */
  media_id?: string;
}

export type StepOutput =
  IdeaOutput | ScriptOutput | FramesOutput | StillsOutput | QuoteOutput | RenderOutput;

export interface FakeContext {
  idea: string;
  style: string | null;
  useAvatar: boolean;
  faceModel: string;
  /** Script version so far (a script rework bumps it). */
  scriptVersion: number;
  /** Visuals rework count, so redone stills differ. */
  attempt: number;
}

export const FAKE_SLOTS: readonly SlotPlan[] = [
  { slot: "hook", seconds: 5 },
  { slot: "mid", seconds: 6 },
  { slot: "cta", seconds: 4 },
];
export const FAKE_DURATION_S = 60;

function topic(idea: string): string {
  const t = idea
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.?!]+$/, "");
  return t || "How tides work";
}

function frame(style: string | null, n: number): string {
  const pack = stylePack(style);
  return n === 1 && pack?.example ? pack.example : `/factory/fake/still-${((n - 1) % 4) + 1}.svg`;
}

export function fakeOutput(step: FactoryStep, ctx: FakeContext): StepOutput {
  const t = topic(ctx.idea);
  switch (step) {
    case "idea":
      return {
        title: t.length > 60 ? `${t.slice(0, 57)}...` : t,
        brief: `A 60-second explainer: ${t}. One clear idea, a surprising fact up front, no call to action.`,
        audience: "Curious adults scrolling Reels; no background knowledge.",
        hook: `You've been wrong about this your whole life.`,
      };
    case "script": {
      const v = ctx.scriptVersion + 1;
      const lines: ScriptLine[] = [
        {
          id: "l1",
          text: "You've been wrong about this your whole life.",
          slot: ctx.useAvatar ? "hook" : null,
        },
        { id: "l2", text: `Here's what really happens: ${t.toLowerCase()}.` },
        {
          id: "l3",
          text: "It starts with something you can't see.",
          slot: ctx.useAvatar ? "mid" : null,
        },
        { id: "l4", text: "Then it builds, slowly, every single day." },
        {
          id: "l5",
          text: v > 1 ? `Version ${v}: and now you know.` : "And now you know.",
          slot: ctx.useAvatar ? "cta" : null,
        },
      ];
      return { version: v, hook: lines[0]?.text ?? "", lines };
    }
    case "style":
      return {
        frames: [{ url: frame(ctx.style, 1), caption: "The hook beat in the chosen style." }],
      };
    case "visuals":
      return {
        stills: [1, 2, 3, 4].map((n) => ({
          url: frame(ctx.style, n + ctx.attempt),
          scene: `s${n}`,
          caption: ["Hook", "The cause", "The build-up", "The payoff"][n - 1] ?? `Scene ${n}`,
        })),
      };
    case "face_quote":
      return {
        model: ctx.faceModel,
        slots: [...FAKE_SLOTS],
        quote: estimateFaceClips(ctx.faceModel, FAKE_SLOTS),
      };
    case "render": {
      const faceS = FAKE_SLOTS.reduce((s, x) => s + x.seconds, 0);
      return {
        duration_s: FAKE_DURATION_S,
        face_share: ctx.useAvatar ? faceS / FAKE_DURATION_S : null,
        imagery_credits: [],
      };
    }
  }
}
