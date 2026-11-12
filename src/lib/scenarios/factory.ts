import { estimateFaceClips } from "@/lib/domain/factory/budget";
import { FAKE_SLOTS, fakeOutput, type FakeContext } from "@/lib/domain/factory/fake-outputs";
import { buildRecipe } from "@/lib/domain/factory/recipe";
import { stepsFor, type FactoryStep, type StepStatus } from "@/lib/domain/factory/steps";
import type { Json } from "@/lib/db/types";
import { stableUuid } from "@/lib/hash";
import { FAKE_PERMALINK_BASE, fakeUserId } from "@/lib/providers/fake";
import maya from "./maya-avatar.json";
import { emptySeed, type SandboxSeed, type Scenario } from "./types";

/**
 * Content Factory scenarios (BC-24…28). The fake runner drives every step in the Sandbox, so each
 * state here can be QA'd on production without sessions or money.
 */

const TIMEZONE = "Europe/London";
const HOUR_MS = 3_600_000;
const PAGE = "/factory";

type Id = (...parts: string[]) => string;

interface AccountSpec {
  key: string;
  handle: string;
  brand: string;
  slots: string[];
  aiDone?: boolean;
}

const ACCOUNTS: readonly AccountSpec[] = [
  {
    key: "cj",
    handle: "codingjourney",
    brand: "Coding Journey",
    slots: ["09:00", "13:00", "19:00"],
  },
  { key: "maya", handle: "maya.explains", brand: "Maya explains", slots: ["12:00", "18:30"] },
];

/** An avatar profile in the avatar.json shape (references/avatar-profile.md). */
export function mayaProfile(
  version: number,
  faceModel = "fal-kling-avatar-std",
): NonNullable<Json> {
  return {
    ...(maya as Record<string, Json>),
    version,
    generation: { ...maya.generation, face_model: faceModel },
  };
}

function baseSeed(name: string, now: Date, accounts = ACCOUNTS): { seed: SandboxSeed; id: Id } {
  const seed = emptySeed(TIMEZONE);
  const id: Id = (...parts) => stableUuid(name, ...parts);
  accounts.forEach((spec, index) => {
    const brandId = id("brand", spec.key);
    const accountId = id("account", spec.key);
    seed.brands.push({ id: brandId, name: spec.brand });
    seed.accounts.push({
      id: accountId,
      created_at: new Date(now.getTime() - (10 - index) * 24 * HOUR_MS).toISOString(),
      brand_id: brandId,
      platform: "fake",
      platform_user_id: fakeUserId(spec.handle),
      handle: spec.handle,
      profile_url: `${FAKE_PERMALINK_BASE}/${spec.handle}`,
      slots: spec.slots,
      status: "ready",
      followers: 1200,
      ai_label_done: spec.aiDone ?? false,
      ai_bio_done: spec.aiDone ?? false,
    });
    seed.fakeAccounts.push({ account_id: accountId, failure_mode: null, failures_left: null });
  });
  return { seed, id };
}

function addMaya(seed: SandboxSeed, id: Id, now: Date, faceModel = "fal-kling-avatar-std") {
  const avatarId = id("avatar", "maya");
  seed.factory.avatars.push({
    id: avatarId,
    account_id: id("account", "maya"),
    name: "Maya",
    studio_step: "done",
    current_version: 1,
    profile: mayaProfile(1, faceModel),
    studio: {},
  });
  seed.factory.avatarVersions.push({
    avatar_id: avatarId,
    version: 1,
    profile: mayaProfile(1, faceModel),
    note: "Screen test approved.",
  });
  return avatarId;
}

interface ProductionSpec {
  key: string;
  idea: string;
  style: string;
  account: string;
  avatar?: string | null;
  /** Steps done (approved); the next one gets `current`. */
  done: FactoryStep[];
  current?: { step: FactoryStep; status: StepStatus; progress?: number; message?: string };
  status: "draft" | "running" | "waiting" | "ready" | "scheduled" | "failed";
  faceModel?: string;
  hoursAgo: number;
  autopilot?: boolean;
}

function addProduction(seed: SandboxSeed, id: Id, now: Date, spec: ProductionSpec) {
  const pid = id("production", spec.key);
  const useAvatar = Boolean(spec.avatar);
  const faceModel = spec.faceModel ?? "fal-kling-avatar-std";
  const ctx: FakeContext = {
    idea: spec.idea,
    style: spec.style,
    useAvatar,
    faceModel,
    scriptVersion: 0,
    attempt: 0,
  };
  const script = fakeOutput("script", ctx) as { version: number; hook: string; lines: unknown[] };
  const hasScript = spec.done.includes("script");
  const at = (h: number) => new Date(now.getTime() - h * HOUR_MS).toISOString();

  let mediaId: string | null = null;
  if (spec.done.includes("render")) {
    mediaId = id("media", spec.key);
    seed.media.push({
      id: mediaId,
      storage_path: `sandbox/factory/${spec.key}.mp4`,
      duration_s: 60,
      width: 1080,
      height: 1920,
      bytes: 12_000_000,
      recipe: buildRecipe({
        productionId: pid,
        style: spec.style,
        avatarName: useAvatar ? "Maya" : null,
        avatarVersion: useAvatar ? 1 : null,
        faceModel: useAvatar ? faceModel : null,
        faceShare: useAvatar ? 0.25 : null,
        voice: "design-m2",
        music: "floating-cities",
        hook: script.hook,
        scriptVersion: script.version,
        series: null,
        costUsd: useAvatar ? estimateFaceClips(faceModel, FAKE_SLOTS).baseUsd : 0,
      }) as unknown as Json,
    });
  }

  const credits = [
    'Music: "Floating Cities" by Kevin MacLeod (incompetech.com), CC BY 4.0',
    "Voice: AI (Qwen3-TTS)",
    ...(useAvatar ? ["Presenter: AI-generated avatar."] : []),
  ].join("\n");
  const caption = `${script.hook} ${spec.idea}.\n\n${credits}`;

  seed.factory.productions.push({
    id: pid,
    created_at: at(spec.hoursAgo),
    title: spec.idea,
    idea: spec.idea,
    style: spec.style,
    use_avatar: useAvatar,
    avatar_id: spec.avatar ?? null,
    avatar_version: useAvatar ? 1 : null,
    voice_key: "design-m2",
    music_key: "floating-cities",
    account_id: id("account", spec.account),
    status: spec.status,
    step_modes: spec.autopilot
      ? {
          idea: "auto",
          script: "auto",
          style: "auto",
          visuals: "auto",
          face_quote: "auto",
          render: "auto",
        }
      : {},
    script: hasScript ? (script as unknown as Json) : null,
    media_id: mediaId,
    caption: mediaId ? caption : null,
    caption_options: mediaId
      ? [caption, `Ever wondered ${spec.idea.toLowerCase()}?\n\n${credits}`]
      : [],
    project_slug: `${spec.key}-01`,
  });

  if (spec.status === "draft") return pid;
  for (const step of stepsFor(useAvatar)) {
    const done = spec.done.includes(step);
    const cur = spec.current?.step === step ? spec.current : null;
    const output =
      done || cur?.status === "waiting"
        ? (fakeOutput(step, ctx) as unknown as NonNullable<Json>)
        : {};
    if (step === "render" && mediaId && output && typeof output === "object") {
      (output as Record<string, Json>).media_id = mediaId;
    }
    seed.factory.steps.push({
      production_id: pid,
      step,
      status: done ? "approved" : (cur?.status ?? "pending"),
      progress: done ? 100 : (cur?.progress ?? (cur?.status === "waiting" ? 100 : 0)),
      message: cur?.message ?? null,
      output,
      attempt: done || cur ? 1 : 0,
      started_at: done || cur ? at(spec.hoursAgo - 0.5) : null,
      finished_at: done ? at(spec.hoursAgo - 1) : null,
    });
  }

  // Paid clips of a rendered avatar video (completed jobs: the spend log).
  if (useAvatar && spec.done.includes("render")) {
    for (const s of FAKE_SLOTS) {
      seed.factory.genJobs.push({
        production_id: pid,
        avatar_id: spec.avatar ?? null,
        kind: "face",
        slot: s.slot,
        model: faceModel,
        provider: "fal",
        idempotency_key: `fake:${pid}:${s.slot}:render1`,
        seconds: s.seconds,
        quote_usd: estimateFaceClips(faceModel, [s]).baseUsd,
        cost_usd: estimateFaceClips(faceModel, [s]).baseUsd,
        status: "completed",
        output_url: "/factory/fake/still-1.svg",
        completed_at: at(spec.hoursAgo - 1),
        created_at: at(spec.hoursAgo - 1),
      });
    }
  }
  return pid;
}

export const factoryNew: Scenario = {
  name: "factory-new",
  page: PAGE,
  description:
    "Content Factory, empty: two accounts (@maya.explains has the avatar Maya v1, disclosure not done yet). Make a video from scratch.",
  build({ now }) {
    const { seed, id } = baseSeed("factory-new", now);
    addMaya(seed, id, now);
    return seed;
  },
};

export const factoryPipeline: Scenario = {
  name: "factory-pipeline",
  page: PAGE,
  description:
    "Five videos in every state: a draft, a script waiting for approval, a render at 60%, one ready to schedule and one failed.",
  build({ now }) {
    const { seed, id } = baseSeed("factory-pipeline", now);
    const maya = addMaya(seed, id, now);
    addProduction(seed, id, now, {
      key: "draft",
      idea: "Why the sky is blue",
      style: "luminous-3d",
      account: "cj",
      done: [],
      status: "draft",
      hoursAgo: 1,
    });
    addProduction(seed, id, now, {
      key: "script",
      idea: "How the moon causes tides",
      style: "realistic-3d",
      account: "cj",
      done: ["idea"],
      current: { step: "script", status: "waiting" },
      status: "waiting",
      hoursAgo: 3,
    });
    addProduction(seed, id, now, {
      key: "render",
      idea: "How a git merge works",
      style: "motion-graphics",
      account: "cj",
      done: ["idea", "script", "style", "visuals"],
      current: {
        step: "render",
        status: "running",
        progress: 60,
        message: "Rendering scene 3 of 5.",
      },
      status: "running",
      hoursAgo: 6,
    });
    addProduction(seed, id, now, {
      key: "ready",
      idea: "How clouds float",
      style: "editorial-collage",
      account: "maya",
      avatar: maya,
      done: ["idea", "script", "style", "visuals", "face_quote", "render"],
      status: "ready",
      hoursAgo: 20,
    });
    addProduction(seed, id, now, {
      key: "failed",
      idea: "Why ice floats",
      style: "handmade-2d",
      account: "cj",
      done: ["idea", "script"],
      current: {
        step: "style",
        status: "failed",
        message: "The session stopped: Remotion couldn't load the paper texture. Redo the step.",
      },
      status: "failed",
      hoursAgo: 30,
    });
    return seed;
  },
};

export const factoryAvatarQuote: Scenario = {
  name: "factory-avatar-quote",
  page: PAGE,
  description:
    "An avatar video waiting at the paid step: the avatar clip quote (Kling Standard, 15 s) with $1.20 already spent this month.",
  build({ now }) {
    const { seed, id } = baseSeed("factory-avatar-quote", now);
    const maya = addMaya(seed, id, now);
    seed.factory.settings = {
      enabled_models: [
        "placeholder",
        "fal-kling-avatar-std",
        "fal-kling-avatar-pro",
        "fal-omnihuman-1.5",
      ],
      default_face_model: "fal-kling-avatar-std",
      fallback_face_model: "placeholder",
    };
    addProduction(seed, id, now, {
      key: "quote",
      idea: "How tides work",
      style: "realistic-3d",
      account: "maya",
      avatar: maya,
      done: ["idea", "script", "style", "visuals"],
      current: { step: "face_quote", status: "waiting" },
      status: "waiting",
      hoursAgo: 2,
    });
    // Earlier spend this month (another video).
    seed.factory.genJobs.push({
      production_id: null,
      kind: "face",
      slot: "hook",
      model: "fal-kling-avatar-std",
      provider: "fal",
      idempotency_key: "fake:earlier:hook",
      seconds: 21.4,
      quote_usd: 1.2,
      cost_usd: 1.2,
      status: "completed",
      created_at: new Date(now.getTime() - 26 * HOUR_MS).toISOString(),
    });
    return seed;
  },
};

export const factoryOverCap: Scenario = {
  name: "factory-over-cap",
  page: PAGE,
  description:
    "The monthly cap is nearly used ($49.50 of $50): the avatar quote can't be approved and autopilot pauses.",
  build({ now }) {
    const { seed, id } = baseSeed("factory-over-cap", now);
    const maya = addMaya(seed, id, now);
    seed.factory.settings = {
      enabled_models: ["placeholder", "fal-kling-avatar-std"],
      default_face_model: "fal-kling-avatar-std",
    };
    addProduction(seed, id, now, {
      key: "quote",
      idea: "Why the sea is salty",
      style: "realistic-3d",
      account: "maya",
      avatar: maya,
      done: ["idea", "script", "style", "visuals"],
      current: {
        step: "face_quote",
        status: "waiting",
        message:
          "Autopilot paused: the quote ($1.05) is more than what is left under the caps ($0.50).",
      },
      status: "waiting",
      hoursAgo: 2,
      autopilot: true,
    });
    seed.factory.genJobs.push({
      production_id: null,
      kind: "face",
      slot: "hook",
      model: "fal-omnihuman-1.5",
      provider: "fal",
      idempotency_key: "fake:month:big",
      seconds: 300,
      quote_usd: 49.5,
      cost_usd: 49.5,
      status: "completed",
      created_at: new Date(now.getTime() - 48 * HOUR_MS).toISOString(),
    });
    return seed;
  },
};

export const factoryRework: Scenario = {
  name: "factory-rework",
  page: PAGE,
  description:
    "A finished avatar video with three paid clips ($0.84): redo the voice or music and the clips are kept; only “Redo this avatar slot” pays.",
  build({ now }) {
    const { seed, id } = baseSeed("factory-rework", now);
    const maya = addMaya(seed, id, now);
    seed.factory.settings = {
      enabled_models: ["placeholder", "fal-kling-avatar-std"],
      default_face_model: "fal-kling-avatar-std",
    };
    addProduction(seed, id, now, {
      key: "done",
      idea: "How rainbows form",
      style: "luminous-3d",
      account: "maya",
      avatar: maya,
      done: ["idea", "script", "style", "visuals", "face_quote", "render"],
      status: "ready",
      hoursAgo: 5,
    });
    return seed;
  },
};

export const FACTORY_SCENARIOS: readonly Scenario[] = [
  factoryNew,
  factoryPipeline,
  factoryAvatarQuote,
  factoryOverCap,
  factoryRework,
];
