import { FAKE_INTENTS, fakeReply } from "@/lib/domain/factory/events";
import { frameAt, type NoteKind } from "@/lib/domain/factory/notes";
import { stableUuid } from "@/lib/hash";
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

export const STUDIO_SCENARIOS: readonly Scenario[] = [
  factoryVersions,
  factoryBatchSent,
  factoryBatchAnswered,
  factoryReadyToPost,
  factoryReadyFailing,
];
