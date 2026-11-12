import { estimateFaceClips, roundUsdValue } from "./budget";
import { faceModel } from "./models";

/**
 * The Avatar studio (pure): the flow from references/avatar-profile.md, candidates for the fake
 * runner, assembling the profile, and versioning (look or voice changes bump the version).
 */

export type StudioStep = "persona" | "portrait" | "face_pack" | "voice" | "screen_test" | "done";

export const STUDIO_STEPS: readonly Exclude<StudioStep, "done">[] = [
  "persona",
  "portrait",
  "face_pack",
  "voice",
  "screen_test",
];

export const STUDIO_LABELS: Record<Exclude<StudioStep, "done">, string> = {
  persona: "Persona drafts",
  portrait: "Master portrait",
  face_pack: "Face pack",
  voice: "Voice",
  screen_test: "Screen test",
};

export const STUDIO_HELP: Record<Exclude<StudioStep, "done">, string> = {
  persona: "Claude drafts 3 persona concepts from the account's brief. Pick one and edit it.",
  portrait:
    "About 8 master-portrait candidates from an image model (cents each). The pick must pass the checklist: one face, eyes to camera, mouth closed, head and shoulders 9:16, even light, plain background, at least 1080 px, no text.",
  face_pack:
    "4–6 shots from the master (angles and expressions) plus one per wardrobe and setting. Approve or reject each.",
  voice:
    "Three voices from the persona, picked blind; the reference clip and seed are then locked.",
  screen_test:
    "One 8–10 s clip on the default model and one on the fallback, from the same audio. Approve one and the avatar is saved as v1.",
};

/** Estimated price of one master-portrait image (image models cost cents each). */
export const PORTRAIT_ESTIMATE_USD = 0.04;
export const PORTRAIT_COUNT = 8;
export const SCREEN_TEST_SECONDS = 10;

export function isPaidStudioStep(step: StudioStep): boolean {
  return step === "portrait" || step === "face_pack" || step === "screen_test";
}

export function nextStudioStep(step: StudioStep): StudioStep {
  const i = STUDIO_STEPS.indexOf(step as Exclude<StudioStep, "done">);
  return i < 0 || i + 1 >= STUDIO_STEPS.length ? "done" : (STUDIO_STEPS[i + 1] ?? "done");
}

/** What a studio step costs before it runs. */
export function studioEstimate(
  step: StudioStep,
  models: { primary: string; fallback: string | null },
): number {
  if (step === "portrait") return roundUsdValue(PORTRAIT_COUNT * PORTRAIT_ESTIMATE_USD);
  if (step === "face_pack") return roundUsdValue(6 * PORTRAIT_ESTIMATE_USD);
  if (step === "screen_test") {
    const slot = [{ slot: "test", seconds: SCREEN_TEST_SECONDS }];
    const a = estimateFaceClips(models.primary, slot, 0).totalUsd;
    const b = models.fallback ? estimateFaceClips(models.fallback, slot, 0).totalUsd : 0;
    return roundUsdValue(a + b);
  }
  return 0;
}

export interface Persona {
  id: string;
  name: string;
  age_range: string;
  from: string;
  backstory: string;
  tone: string;
  energy: string;
  signature_phrase: string;
}

export interface Candidate {
  id: string;
  url: string;
  label: string;
  status?: "pending" | "approved" | "rejected";
}

export interface VoiceCandidate {
  key: string;
  label: string;
  sample_url: string | null;
}

export interface ScreenTest {
  model: string;
  url: string;
  cost_usd: number;
}

export interface Studio {
  personas?: Persona[];
  persona_pick?: string;
  portraits?: Candidate[];
  portrait_pick?: string;
  face_pack?: Candidate[];
  voices?: VoiceCandidate[];
  voice_pick?: string;
  screen_tests?: ScreenTest[];
  screen_pick?: string;
  modes?: Partial<Record<Exclude<StudioStep, "done">, "wait" | "auto">>;
}

/** Canned candidates for the fake runner (Sandbox). */
export function fakeCandidates(
  step: Exclude<StudioStep, "done">,
  input: {
    name: string;
    voices: VoiceCandidate[];
    models: { primary: string; fallback: string | null };
  },
): Partial<Studio> {
  const still = (n: number) => `/factory/fake/still-${((n - 1) % 4) + 1}.svg`;
  switch (step) {
    case "persona":
      return {
        personas: [
          {
            id: "p1",
            name: input.name,
            age_range: "late 20s",
            from: "Cape Town",
            backstory: "A science teacher turned explainer who makes physics feel obvious.",
            tone: "warm, dry humour",
            energy: "calm",
            signature_phrase: "Here's the thing.",
          },
          {
            id: "p2",
            name: input.name,
            age_range: "mid 30s",
            from: "Austin",
            backstory: "A former park ranger who explains nature on hikes.",
            tone: "curious, upbeat",
            energy: "bright",
            signature_phrase: "Look closer.",
          },
          {
            id: "p3",
            name: input.name,
            age_range: "early 40s",
            from: "Glasgow",
            backstory: "An engineer who loves how everyday things work.",
            tone: "plain-spoken, wry",
            energy: "steady",
            signature_phrase: "Right, so.",
          },
        ],
      };
    case "portrait":
      return {
        portraits: Array.from({ length: PORTRAIT_COUNT }, (_, i) => ({
          id: `m${i + 1}`,
          url: still(i + 1),
          label: `Candidate ${i + 1}`,
        })),
      };
    case "face_pack":
      return {
        face_pack: [
          "Frontal",
          "Three-quarter left",
          "Three-quarter right",
          "Smile",
          "Wardrobe w1",
          "Setting s1",
        ].map((label, i) => ({
          id: `f${i + 1}`,
          url: still(i + 1),
          label,
          status: "pending",
        })),
      };
    case "voice":
      return { voices: input.voices.slice(0, 3) };
    case "screen_test": {
      const models = [input.models.primary, input.models.fallback].filter((m): m is string =>
        Boolean(m),
      );
      return {
        screen_tests: models.map((m, i) => ({
          model: m,
          url: still(i + 1),
          cost_usd: estimateFaceClips(m, [{ slot: "test", seconds: SCREEN_TEST_SECONDS }], 0)
            .totalUsd,
        })),
      };
    }
  }
}

/** Whether a studio step has what it needs to move on. */
export function stepPicked(step: Exclude<StudioStep, "done">, s: Studio): string | null {
  switch (step) {
    case "persona":
      return s.persona_pick ? null : "Pick a persona.";
    case "portrait":
      return s.portrait_pick ? null : "Pick a master portrait.";
    case "face_pack": {
      const approved = (s.face_pack ?? []).filter((c) => c.status === "approved").length;
      return approved >= 4 ? null : `Approve at least 4 shots (${approved} so far).`;
    }
    case "voice":
      return s.voice_pick ? null : "Pick a voice.";
    case "screen_test":
      return s.screen_pick ? null : "Pick the screen test that works.";
  }
}

/** The avatar.json profile from the studio's picks (references/avatar-profile.md). */
export function assembleProfile(input: {
  base: Record<string, unknown>;
  studio: Studio;
  account: string | null;
  version: number;
  capUsd: number | null;
}): Record<string, unknown> {
  const s = input.studio;
  const persona = s.personas?.find((p) => p.id === s.persona_pick);
  const master = s.portraits?.find((p) => p.id === s.portrait_pick);
  const pack = (s.face_pack ?? []).filter((c) => c.status === "approved");
  const test = s.screen_tests?.find((t) => t.model === s.screen_pick);
  const base = input.base as Record<string, Record<string, unknown> | undefined>;
  return {
    ...input.base,
    version: input.version,
    account: input.account,
    disclosure: "AI creator",
    identity: {
      ...(base.identity ?? {}),
      ...(persona
        ? {
            name: persona.name,
            age_range: persona.age_range,
            from: persona.from,
            backstory: persona.backstory,
          }
        : {}),
    },
    personality: {
      ...(base.personality ?? {}),
      ...(persona
        ? {
            tone: persona.tone,
            energy: persona.energy,
            signature_phrases: [persona.signature_phrase],
          }
        : {}),
    },
    look: {
      ...(base.look ?? {}),
      ...(master ? { master_ref: master.url } : {}),
      ...(pack.length ? { face_pack: pack.map((c) => c.url) } : {}),
    },
    voice: {
      ...(base.voice ?? {}),
      ...(s.voice_pick ? { provider: "qwen", voice_id: s.voice_pick } : {}),
    },
    rules: base.rules ?? {
      do: ["explain, react, present"],
      dont: [
        "claim to be human",
        "claim to have used a product",
        "imitate a real person",
        "medical/financial advice",
      ],
      platform_flags: { instagram: { is_ai_generated: true }, tiktok: { is_aigc: true } },
    },
    generation: {
      ...(base.generation ?? {}),
      ...(test ? { face_model: test.model } : {}),
      ...(input.capUsd !== null ? { cost_cap_per_video_usd: input.capUsd } : {}),
    },
  };
}

/** Changing the look or the voice makes a new version; other edits keep it. */
export function needsNewVersion(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  const same = (k: string) =>
    JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null);
  return !same("look") || !same("voice");
}

export function validFaceModelKey(key: unknown): key is string {
  return typeof key === "string" && Boolean(faceModel(key));
}
