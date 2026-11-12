/**
 * The production pipeline (pure). A Claude session runs each step and posts a checkpoint; the
 * step then waits for Matthew ("Wait for me") or is approved at once ("Autopilot"). Autopilot
 * approves a paid step only when its quote fits under the caps.
 */

export type FactoryStep = "idea" | "script" | "style" | "visuals" | "face_quote" | "render";
export type StepStatus = "pending" | "running" | "waiting" | "approved" | "failed" | "skipped";
export type StepMode = "wait" | "auto";
export type StepModes = Partial<Record<FactoryStep, StepMode>>;

export const ALL_STEPS: readonly FactoryStep[] = [
  "idea",
  "script",
  "style",
  "visuals",
  "face_quote",
  "render",
];

export const STEP_LABELS: Record<FactoryStep, string> = {
  idea: "Idea brief",
  script: "Script",
  style: "Style frames",
  visuals: "Visuals (stills)",
  face_quote: "Avatar clip quote",
  render: "Render",
};

export const STEP_HELP: Record<FactoryStep, string> = {
  idea: "Claude turns the idea into a brief: what the video explains, the audience and the hook.",
  script: "The lines the voice reads, with the avatar's cut-in slots marked.",
  style: "One frame of the same beat in the chosen style.",
  visuals: "Key stills of each scene for review before the render.",
  face_quote:
    "The price of the avatar clips (registry price × seconds), before any money is spent.",
  render: "Voice, music, avatar clips and visuals rendered with Remotion, then uploaded.",
};

/** Steps that spend money when approved. */
export const PAID_STEPS: readonly FactoryStep[] = ["face_quote"];

export function isPaidStep(step: FactoryStep): boolean {
  return PAID_STEPS.includes(step);
}

/** The steps a production runs: face_quote only for avatar videos. */
export function stepsFor(useAvatar: boolean): FactoryStep[] {
  return ALL_STEPS.filter((s) => s !== "face_quote" || useAvatar);
}

export function nextStep(step: FactoryStep, useAvatar: boolean): FactoryStep | null {
  const steps = stepsFor(useAvatar);
  const i = steps.indexOf(step);
  return i >= 0 && i + 1 < steps.length ? (steps[i + 1] ?? null) : null;
}

export function isStep(value: unknown): value is FactoryStep {
  return typeof value === "string" && (ALL_STEPS as readonly string[]).includes(value);
}

/** The video's own setting, else the workspace default, else "wait". */
export function modeFor(step: FactoryStep, video: StepModes, workspace: StepModes): StepMode {
  return video[step] ?? workspace[step] ?? "wait";
}

export function parseModes(value: unknown): StepModes {
  const out: StepModes = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isStep(k) && (v === "wait" || v === "auto")) out[k] = v;
    }
  }
  return out;
}

export type AutoDecision =
  { approve: true } | { approve: false; reason: "wait" | "over_cap"; message: string };

/**
 * What happens when a checkpoint arrives. A paid step on autopilot is approved only when
 * `quoteUsd` fits in what is left of both caps.
 */
export function decideCheckpoint(input: {
  step: FactoryStep;
  mode: StepMode;
  quoteUsd?: number;
  remainingUsd?: number;
}): AutoDecision {
  if (input.mode === "wait")
    return { approve: false, reason: "wait", message: "Waiting for your approval." };
  if (isPaidStep(input.step)) {
    const quote = input.quoteUsd ?? 0;
    const remaining = input.remainingUsd ?? 0;
    if (quote > remaining + 1e-9) {
      return {
        approve: false,
        reason: "over_cap",
        message: `Autopilot paused: the quote ($${quote.toFixed(2)}) is more than what is left under the caps ($${Math.max(0, remaining).toFixed(2)}).`,
      };
    }
  }
  return { approve: true };
}

export type ProductionStatus = "draft" | "running" | "waiting" | "ready" | "scheduled" | "failed";

/** The production's status from its steps (scheduled is set when it is queued). */
export function productionStatus(
  steps: readonly { step: FactoryStep; status: StepStatus }[],
  current: ProductionStatus,
): ProductionStatus {
  if (current === "scheduled" || current === "draft") return current;
  if (steps.some((s) => s.status === "failed")) return "failed";
  if (steps.some((s) => s.status === "waiting")) return "waiting";
  if (steps.some((s) => s.status === "running")) return "running";
  if (steps.length > 0 && steps.every((s) => s.status === "approved" || s.status === "skipped"))
    return "ready";
  return "running";
}
