import type { Json } from "@/lib/db/types";
import { postedCaption } from "@/lib/domain/factory/delivery";
import { FAKE_INTENTS, fakeReply } from "@/lib/domain/factory/events";
import { fakeOutput } from "@/lib/domain/factory/fake-outputs";
import { frameAt, type NoteKind } from "@/lib/domain/factory/notes";
import { stableUuid } from "@/lib/hash";
import { FAKE_PERMALINK_BASE } from "@/lib/providers/fake";
import { HOUR_MS, addProduction, baseSeed } from "./factory";
import type { SandboxSeed, Scenario } from "./types";

/**
 * Studio scenarios (BC-36, ADR 0008): a finished video with numbered versions, and Matthew's notes
 * on v2 sent as a batch, then answered by v3. The fake runner answers new batches at once.
 */

const KEY = "tides";
const IDEA = "How the moon causes tides";
const FPS = 30;

/** The production page of a studio scenario's video. */
export function studioPage(name: string): string {
  return `/factory/${stableUuid(name, "production", KEY)}`;
}

export interface StudioNoteSpec {
  kind: NoteKind;
  tS: number | null;
  box: { x: number; y: number; w: number; h: number } | null;
  text: string;
}

export const STUDIO_NOTES: readonly StudioNoteSpec[] = [
  {
    kind: "moment",
    tS: 3.2,
    box: null,
    text: "The title lands a beat late; bring it in on the drum hit.",
  },
  {
    kind: "region",
    tS: 12.5,
    box: { x: 0.1, y: 0.62, w: 0.42, h: 0.14 },
    text: "This label is hard to read on a phone. Make it bigger.",
  },
  { kind: "general", tS: null, box: null, text: "The music is a little loud under the voice." },
];

const INTENTS: Record<number, string> = {
  1: "First render: 60 s at 30 fps, loudness −14 LUFS.",
  2: "Re-timed the cut to the music and warmed the grade.",
};

export type StudioStage = "versions" | "batch-sent" | "batch-answered";

/** A ready video (render approved) with v1 and v2, and optionally a batch on v2. */
export function studioSeed(name: string, now: Date, stage: StudioStage): SandboxSeed {
  const { seed, id } = baseSeed(name, now);
  const at = (h: number) => new Date(now.getTime() - h * HOUR_MS).toISOString();
  const pid = addProduction(seed, id, now, {
    key: KEY,
    idea: IDEA,
    style: "realistic-3d",
    account: "cj",
    done: ["idea", "script", "style", "visuals", "render"],
    status: "ready",
    hoursAgo: 30,
  });
  const count = stage === "batch-answered" ? 3 : 2;
  // addProduction made the media of the newest version (productions.media_id).
  const mediaOf = (n: number) => (n === count ? id("media", KEY) : id("media", KEY, `v${n}`));
  const versionId = (n: number) => id("version", String(n));
  const batchId = id("batch", "1");
  for (let n = 1; n <= count; n++) {
    if (n !== count) {
      seed.media.push({
        id: mediaOf(n),
        storage_path: `sandbox/factory/${KEY}-v${n}.mp4`,
        duration_s: 60,
        width: 1080,
        height: 1920,
        bytes: 12_000_000,
      });
    }
    seed.factory.versions.push({
      id: versionId(n),
      production_id: pid,
      number: n,
      media_id: mediaOf(n),
      proxy_path: `/factory/fake/version-${((n - 1) % 3) + 1}.mp4`,
      duration_s: 60,
      fps: FPS,
      width: 1080,
      height: 1920,
      bytes: 12_000_000,
      git_sha: ["", "a1c94e2", "b7d03f9", "c52e118"][n] ?? "0000000",
      made_by: n === 3 ? "revise" : "render",
      batch_id: n === 3 ? batchId : null,
      intent: INTENTS[n] ?? "Answered 3 notes in v3.",
      loudness_lufs: -14,
      true_peak_db: -1.5,
      created_at: at(count === 3 ? 30 - n * 6 : 30 - n * 8),
    });
  }

  seed.factory.events.push(
    {
      production_id: pid,
      actor: "session",
      step: "render",
      intent: FAKE_INTENTS.render,
      created_at: at(25),
    },
    {
      production_id: pid,
      actor: "session",
      step: "render",
      intent: INTENTS[2] ?? "",
      created_at: at(14),
    },
    {
      production_id: pid,
      actor: "matthew",
      step: "render",
      intent: "Approved the render step.",
      created_at: at(13),
    },
  );

  if (stage === "versions") return seed;

  const answered = stage === "batch-answered";
  seed.factory.batches.push({
    id: batchId,
    production_id: pid,
    version_id: versionId(2),
    status: answered ? "answered" : "running",
    sent_at: at(answered ? 20 : 0.2),
    answered_by_version: answered ? versionId(3) : null,
    session_url: null,
  });
  STUDIO_NOTES.forEach((note, i) => {
    const number = i + 1;
    const notChanged = answered && note.kind === "general";
    seed.factory.notes.push({
      id: id("note", String(number)),
      production_id: pid,
      version_id: versionId(2),
      number,
      kind: note.kind,
      t_s: note.tS,
      frame: note.tS === null ? null : frameAt(note.tS, FPS),
      box: note.box,
      text: note.text,
      status: answered ? (notChanged ? "not_changed" : "answered") : "sent",
      batch_id: batchId,
      reply: answered
        ? notChanged
          ? "Left the music as is: it already sits 18 dB under the voice (−14 LUFS overall)."
          : fakeReply(number, note.text)
        : null,
      answered_in_version: answered ? versionId(3) : null,
      created_at: at(answered ? 21 : 0.5),
    });
  });
  seed.factory.events.push({
    production_id: pid,
    actor: "matthew",
    step: "revise",
    intent: "Sent 3 notes on v2.",
    created_at: at(answered ? 20 : 0.2),
  });
  seed.factory.events.push({
    production_id: pid,
    actor: "session",
    step: "revise",
    intent: FAKE_INTENTS.revise,
    created_at: at(answered ? 19.5 : 0.1),
  });
  if (answered) {
    seed.factory.events.push({
      production_id: pid,
      actor: "session",
      step: "revise",
      intent: "Answered 3 notes in v3.",
      created_at: at(18),
    });
  }
  return seed;
}

export const factoryVersions: Scenario = {
  name: "factory-versions",
  page: studioPage("factory-versions"),
  description:
    "A finished video with two versions (v1 and v2, v2 current) and its activity: add notes and send them.",
  build: ({ now }) => studioSeed("factory-versions", now, "versions"),
};

export const factoryBatchSent: Scenario = {
  name: "factory-batch-sent",
  page: studioPage("factory-batch-sent"),
  description:
    "Three notes on v2 (a moment, a region and a general one) sent as a batch; the session is working on them.",
  build: ({ now }) => studioSeed("factory-batch-sent", now, "batch-sent"),
};

export const factoryBatchAnswered: Scenario = {
  name: "factory-batch-answered",
  page: studioPage("factory-batch-answered"),
  description: "v3 answered the three notes on v2: two changed, one not changed with the reason.",
  build: ({ now }) => studioSeed("factory-batch-answered", now, "batch-answered"),
};

/**
 * v3 answered the notes and is the version to post. `failing`: v3 runs 95 s (Reels stop at 90) and
 * the caption lost its music credit; a cover is already picked, so exactly those two checks fail.
 */
export function readySeed(name: string, now: Date, failing: boolean): SandboxSeed {
  const seed = studioSeed(name, now, "batch-answered");
  const p = seed.factory.productions[0];
  const v3 = seed.factory.versions.find((v) => v.number === 3);
  if (!p || !v3?.id) return seed;
  if (!failing) return seed;
  v3.duration_s = 95;
  const media = seed.media.find((m) => m.id === v3.media_id);
  if (media) media.duration_s = 95;
  const caption = (p.caption ?? "")
    .split("\n")
    .filter((line) => !line.startsWith("Music:"))
    .join("\n");
  p.caption = caption;
  seed.factory.packs.push({
    production_id: p.id ?? "",
    version_id: v3.id,
    cover_path: "/factory/fake/still-2.svg",
    cover_t_s: 2,
    caption,
    hashtags: ["tides", "moon"],
  });
  return seed;
}

export const factoryReadyToPost: Scenario = {
  name: "factory-ready-to-post",
  page: studioPage("factory-ready-to-post"),
  description:
    "v3 answered the notes and passes every check except the cover: pick a frame, add hashtags, Mark ready.",
  build: ({ now }) => readySeed("factory-ready-to-post", now, false),
};

export const factoryReadyFailing: Scenario = {
  name: "factory-ready-failing",
  page: studioPage("factory-ready-failing"),
  description:
    "v3 is 95 s long and the caption lost its music credit: two checks fail and Mark ready is off.",
  build: ({ now }) => readySeed("factory-ready-failing", now, true),
};

/** The cover the ready-pack scenarios picked (a public sample still). */
export const PACK_COVER = "/factory/fake/still-2.svg";

/**
 * v3 is marked ready (cover, caption with its credits, hashtags): Assign and schedule is open.
 * `scheduled`: it is already queued on @codingjourney, due a minute ago, so a tick uploads it
 * with its cover (BC-43).
 */
export function packReadySeed(name: string, now: Date, scheduled: boolean): SandboxSeed {
  const seed = readySeed(name, now, false);
  const p = seed.factory.productions[0];
  const v3 = seed.factory.versions.find((v) => v.number === 3);
  if (!p?.id || !v3?.id) return seed;
  const caption = p.caption ?? "";
  const hashtags = ["tides", "moon"];
  seed.factory.packs.push({
    production_id: p.id,
    version_id: v3.id,
    cover_path: PACK_COVER,
    cover_t_s: 2,
    caption,
    hashtags,
    ready_at: new Date(now.getTime() - HOUR_MS).toISOString(),
  });
  const media = seed.media.find((m) => m.id === v3.media_id);
  if (media) media.cover_path = PACK_COVER;
  if (!scheduled || !v3.media_id) return seed;

  const postId = stableUuid(name, "post", "v3");
  const posted = postedCaption(caption, hashtags);
  seed.posts.push({
    id: postId,
    account_id: p.account_id ?? "",
    media_id: v3.media_id,
    caption: posted,
    timing: "pinned",
    scheduled_at: new Date(now.getTime() - 60_000).toISOString(),
    status: "queued",
  });
  p.post_id = postId;
  p.media_id = v3.media_id;
  p.caption = posted;
  p.status = "scheduled";
  seed.factory.events.push({
    production_id: p.id,
    actor: "matthew",
    intent: "Scheduled v3 for @codingjourney, Today.",
    created_at: new Date(now.getTime() - 30 * 60_000).toISOString(),
  });
  return seed;
}

export const factoryPackReady: Scenario = {
  name: "factory-pack-ready",
  page: studioPage("factory-pack-ready"),
  description:
    "v3 is marked ready (cover, caption, hashtags): assign it to @codingjourney and schedule it.",
  build: ({ now }) => packReadySeed("factory-pack-ready", now, false),
};

export const factoryScheduledCover: Scenario = {
  name: "factory-scheduled-cover",
  page: "/workflow",
  description:
    "v3 with its cover is scheduled on @codingjourney and due now: Run tick now uploads it with the cover.",
  build: ({ now }) => packReadySeed("factory-scheduled-cover", now, true),
};

/** A video at the visuals step, waiting, with the fake runner's five board cards. */
export function boardSeed(name: string, now: Date): SandboxSeed {
  const { seed, id } = baseSeed(name, now);
  const pid = addProduction(seed, id, now, {
    key: KEY,
    idea: IDEA,
    style: "realistic-3d",
    account: "cj",
    done: ["idea", "script", "style"],
    current: { step: "visuals", status: "waiting" },
    status: "waiting",
    hoursAgo: 3,
  });
  const visuals = seed.factory.steps.find((s) => s.step === "visuals");
  const cards =
    (
      visuals?.output as
        { cards?: { scene: string; text: string; seconds: number; still: string }[] } | undefined
    )?.cards ?? [];
  cards.forEach((c, i) => {
    seed.factory.cards.push({
      id: id("card", String(i + 1)),
      production_id: pid,
      position: i,
      text: c.text,
      seconds: c.seconds,
      still_path: c.still,
      scene_id: c.scene,
    });
  });
  const p = seed.factory.productions[0];
  if (p) p.board_rev = 1;
  return seed;
}

export const factoryBoard: Scenario = {
  name: "factory-board",
  page: studioPage("factory-board"),
  description:
    "The visuals step waits with a five-card storyboard: edit, reorder, redo a card or approve the board.",
  build: ({ now }) => boardSeed("factory-board", now),
};

/**
 * Six videos across the studio list's filters: a step waiting, a render running, answers to read
 * (the tides video, v3), a pack ready to post, one scheduled and one posted.
 */
export function studioListSeed(name: string, now: Date): SandboxSeed {
  const seed = studioSeed(name, now, "batch-answered");
  const id = (...parts: string[]) => stableUuid(name, ...parts);
  const at = (h: number) => new Date(now.getTime() - h * HOUR_MS).toISOString();
  addProduction(seed, id, now, {
    key: "wait",
    idea: "Why the sky is blue",
    style: "luminous-3d",
    account: "cj",
    done: ["idea"],
    current: { step: "script", status: "waiting" },
    status: "waiting",
    hoursAgo: 2,
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
      progress: 40,
      message: "Rendering scene 2 of 5.",
    },
    status: "running",
    hoursAgo: 5,
  });
  const done = ["idea", "script", "style", "visuals", "render"] as const;
  const withVersion = (key: string, idea: string, hoursAgo: number) => {
    const pid = addProduction(seed, id, now, {
      key,
      idea,
      style: "editorial-collage",
      account: "maya",
      done: [...done],
      status: "ready",
      hoursAgo,
    });
    const vid = id("version", key, "1");
    seed.factory.versions.push({
      id: vid,
      production_id: pid,
      number: 1,
      media_id: id("media", key),
      proxy_path: "/factory/fake/version-1.mp4",
      duration_s: 60,
      fps: 30,
      width: 1080,
      height: 1920,
      bytes: 12_000_000,
      git_sha: "d41e7a0",
      made_by: "render",
      intent: "First render.",
      loudness_lufs: -14,
      true_peak_db: -1.5,
      created_at: at(hoursAgo - 1),
    });
    seed.factory.events.push({
      production_id: pid,
      actor: "session",
      step: "render",
      intent: `Rendered ${idea.toLowerCase()}.`,
      created_at: at(hoursAgo - 1),
    });
    return { pid, vid };
  };
  const ready = withVersion("ready", "How clouds float", 8);
  seed.factory.packs.push({
    production_id: ready.pid,
    version_id: ready.vid,
    cover_path: "/factory/fake/still-1.svg",
    cover_t_s: 1,
    caption: "Clouds are heavier than you think.",
    hashtags: ["clouds"],
    ready_at: at(7),
  });
  const post = (key: string, idea: string, hoursAgo: number, published: boolean) => {
    const v = withVersion(key, idea, hoursAgo);
    const postId = id("post", key);
    const when = published
      ? at(hoursAgo - 2)
      : new Date(now.getTime() + 20 * HOUR_MS).toISOString();
    if (published) {
      seed.fakeContainers.push({
        id: `fake-container-${key}`,
        account_id: id("account", "maya"),
        video_url: `sandbox://${name}/${postId}.mp4`,
        caption: idea,
        status_checks: 2,
        media_id: `fake-media-${key}`,
        permalink: `${FAKE_PERMALINK_BASE}/maya.explains/${key}`,
        published_at: when,
      });
    }
    seed.posts.push({
      id: postId,
      account_id: id("account", "maya"),
      media_id: id("media", key),
      caption: idea,
      timing: "queue",
      scheduled_at: when,
      status: published ? "published" : "queued",
      ...(published
        ? {
            published_at: when,
            attempts: 1,
            container_id: `fake-container-${key}`,
            media_ig_id: `fake-media-${key}`,
            permalink: `${FAKE_PERMALINK_BASE}/maya.explains/${key}`,
          }
        : {}),
    });
    const p = seed.factory.productions.find((x) => x.id === v.pid);
    if (p) {
      p.post_id = postId;
      p.status = "scheduled";
    }
  };
  post("sched", "Why ice floats", 12, false);
  post("posted", "How rainbows form", 40, true);
  return seed;
}

export const factoryStudioList: Scenario = {
  name: "factory-studio-list",
  page: "/factory",
  description:
    "Six videos across the studio list: a step waiting, a render running, answers to read, one ready to post, one scheduled, one posted.",
  build: ({ now }) => studioListSeed("factory-studio-list", now),
};

/** Comparing styles (BC-41): the style step waits with the hook beat in three styles. */
export function styleCompareSeed(name: string, now: Date): SandboxSeed {
  const { seed, id } = baseSeed(name, now);
  const pid = addProduction(seed, id, now, {
    key: KEY,
    idea: IDEA,
    style: "realistic-3d",
    account: "cj",
    done: ["idea", "script"],
    current: { step: "style", status: "waiting" },
    status: "waiting",
    hoursAgo: 2,
  });
  const p = seed.factory.productions.find((x) => x.id === pid);
  if (p) {
    p.style = null;
    p.compare_styles = true;
  }
  const step = seed.factory.steps.find((x) => x.production_id === pid && x.step === "style");
  if (step) {
    step.output = fakeOutput("style", {
      idea: IDEA,
      style: null,
      compare: [],
      useAvatar: false,
      faceModel: "placeholder",
      scriptVersion: 1,
      attempt: 0,
    }) as unknown as NonNullable<Json>;
  }
  return seed;
}

export const factoryStyleCompare: Scenario = {
  name: "factory-style-compare",
  page: studioPage("factory-style-compare"),
  description:
    "The style step waits with the same hook beat in three styles, one recommended: use one, or use one but with a note.",
  build: ({ now }) => styleCompareSeed("factory-style-compare", now),
};

export const STUDIO_SCENARIOS: readonly Scenario[] = [
  factoryVersions,
  factoryBatchSent,
  factoryBatchAnswered,
  factoryReadyToPost,
  factoryReadyFailing,
  factoryBoard,
  factoryStudioList,
  factoryStyleCompare,
  factoryPackReady,
  factoryScheduledCover,
];
