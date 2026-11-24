/**
 * Delivery checks (pure, ADR 0008): whether a version and its pack are ready to post as a Reel.
 * Format limits come from src/lib/media/checks.ts (the same ones every upload passes); caption
 * credits from captions.ts. Posting itself stays Matthew's action: a ready pack only says it can be.
 */

import { REELS, checkVideo, sizeLabel } from "@/lib/media/checks";
import { CAPTION_MAX } from "./captions";

export const HASHTAGS_MAX = 30;
export const LOUDNESS_LUFS = { min: -16, max: -12 } as const;
export const TRUE_PEAK_MAX_DB = -1;

export type DeliveryCheckKey =
  | "aspect"
  | "size"
  | "duration"
  | "caption_length"
  | "credits"
  | "hashtags"
  | "ai_flag"
  | "loudness"
  | "true_peak";

export interface DeliveryCheck {
  key: DeliveryCheckKey;
  ok: boolean;
  /** Why it fails (empty when ok). */
  message: string;
}

export interface DeliveryInput {
  width: number;
  height: number;
  durationS: number;
  bytes: number;
  /** Measured integrated loudness / true peak, when the render reported them. */
  loudnessLufs?: number | null;
  truePeakDb?: number | null;
  caption: string;
  /** creditLines() for this video: every line must appear in the caption. */
  credits: readonly string[];
  hashtags: readonly string[];
  /** The video shows an AI avatar. */
  avatar: boolean;
  /** The post will be flagged as AI-generated (posts.is_ai_generated). */
  aiFlag: boolean;
}

/** Hashtags in the pack plus any written in the caption, counted once each (case-insensitive). */
export function countHashtags(caption: string, hashtags: readonly string[]): number {
  const tags = new Set<string>();
  for (const t of hashtags) {
    const tag = t.trim().replace(/^#/, "").toLowerCase();
    if (tag) tags.add(tag);
  }
  for (const m of caption.matchAll(/#([\p{L}\p{N}_]+)/gu)) tags.add((m[1] ?? "").toLowerCase());
  return tags.size;
}

const pass = (key: DeliveryCheckKey): DeliveryCheck => ({ key, ok: true, message: "" });
const fail = (key: DeliveryCheckKey, message: string): DeliveryCheck => ({
  key,
  ok: false,
  message,
});

/** Every check, in display order. Loudness checks only appear when the render reported them. */
export function deliveryChecks(input: DeliveryInput): DeliveryCheck[] {
  const issues = checkVideo({
    width: input.width,
    height: input.height,
    durationS: input.durationS,
  });
  const issue = (...codes: string[]) => issues.find((i) => codes.includes(i.code));
  const checks: DeliveryCheck[] = [];

  const aspect = issue("aspect", "width");
  checks.push(aspect ? fail("aspect", aspect.message) : pass("aspect"));

  checks.push(
    input.bytes > REELS.maxBytes
      ? fail(
          "size",
          `This version is ${sizeLabel(input.bytes)}. Reels can be up to ${sizeLabel(REELS.maxBytes)}.`,
        )
      : pass("size"),
  );

  const duration = issue("too_short", "too_long");
  checks.push(duration ? fail("duration", duration.message) : pass("duration"));

  const caption = input.caption;
  checks.push(
    caption.length > CAPTION_MAX
      ? fail(
          "caption_length",
          `The caption is ${caption.length} characters. Instagram allows ${CAPTION_MAX}.`,
        )
      : pass("caption_length"),
  );

  const missing = input.credits.filter((c) => c.trim() && !caption.includes(c.trim()));
  checks.push(
    missing.length
      ? fail(
          "credits",
          `The caption is missing ${missing.length === 1 ? "a credit" : "credits"}: ${missing.join(" · ")}`,
        )
      : pass("credits"),
  );

  const tags = countHashtags(caption, input.hashtags);
  checks.push(
    tags > HASHTAGS_MAX
      ? fail("hashtags", `There are ${tags} hashtags. Instagram allows ${HASHTAGS_MAX}.`)
      : pass("hashtags"),
  );

  checks.push(
    input.avatar && !input.aiFlag
      ? fail("ai_flag", "This video has an AI avatar, so the post must be flagged as AI-generated.")
      : pass("ai_flag"),
  );

  const lufs = input.loudnessLufs;
  if (lufs !== null && lufs !== undefined) {
    checks.push(
      lufs < LOUDNESS_LUFS.min || lufs > LOUDNESS_LUFS.max
        ? fail(
            "loudness",
            `The mix is ${lufs} LUFS. Aim for ${LOUDNESS_LUFS.min} to ${LOUDNESS_LUFS.max} LUFS.`,
          )
        : pass("loudness"),
    );
  }
  const peak = input.truePeakDb;
  if (peak !== null && peak !== undefined) {
    checks.push(
      peak > TRUE_PEAK_MAX_DB
        ? fail(
            "true_peak",
            `The true peak is ${peak} dBTP. Keep it at ${TRUE_PEAK_MAX_DB} dBTP or below.`,
          )
        : pass("true_peak"),
    );
  }
  return checks;
}

/** True when every check passes. */
export function deliveryReady(checks: readonly DeliveryCheck[]): boolean {
  return checks.every((c) => c.ok);
}
