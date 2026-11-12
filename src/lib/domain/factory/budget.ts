import { faceModel, priceFor, roundUsd } from "./models";

/**
 * Money (pure). Every paid action shows an estimate before it runs: registry price × seconds,
 * plus a re-roll allowance where a clip may need a second take. The caps (per video and per
 * month) are enforced by the generation proxy: 402 `budget` and nothing starts.
 */

export const DEFAULT_CAP_PER_VIDEO_USD = 5;
export const DEFAULT_CAP_MONTHLY_USD = 50;
/** Share of clips expected to be generated twice (face checks fail, a bad take). */
export const DEFAULT_REROLL_SHARE = 0.25;

export interface SlotPlan {
  slot: string;
  seconds: number;
}

export interface Estimate {
  model: string;
  seconds: number;
  /** Price of one take of every slot. */
  baseUsd: number;
  /** Allowance for re-rolls. */
  rerollUsd: number;
  totalUsd: number;
  free: boolean;
}

export function estimateFaceClips(
  modelKey: string,
  slots: readonly SlotPlan[],
  rerollShare = DEFAULT_REROLL_SHARE,
): Estimate {
  const model = faceModel(modelKey);
  const seconds = slots.reduce((s, x) => s + x.seconds, 0);
  if (!model)
    return { model: modelKey, seconds, baseUsd: 0, rerollUsd: 0, totalUsd: 0, free: true };
  const baseUsd = roundUsd(slots.reduce((s, x) => s + priceFor(model, x.seconds), 0));
  const rerollUsd = roundUsd(baseUsd * rerollShare);
  return {
    model: model.key,
    seconds,
    baseUsd,
    rerollUsd,
    totalUsd: roundUsd(baseUsd + rerollUsd),
    free: baseUsd === 0,
  };
}

export interface Caps {
  perVideoUsd: number;
  monthlyUsd: number;
}

/** The workspace cap, lowered by the avatar's own `cost_cap_per_video_usd` when it is smaller. */
export function capsFor(settings: Caps, avatarCapUsd?: number | null): Caps {
  const perVideo =
    typeof avatarCapUsd === "number" && avatarCapUsd >= 0
      ? Math.min(settings.perVideoUsd, avatarCapUsd)
      : settings.perVideoUsd;
  return { perVideoUsd: perVideo, monthlyUsd: settings.monthlyUsd };
}

export interface Spend {
  videoUsd: number;
  monthUsd: number;
}

export type BudgetCheck =
  | { ok: true; remainingUsd: number }
  | { ok: false; remainingUsd: number; which: "video" | "month" };

/** Whether `quoteUsd` more fits under both caps. */
export function checkBudget(quoteUsd: number, spend: Spend, caps: Caps): BudgetCheck {
  const videoLeft = roundUsd(caps.perVideoUsd - spend.videoUsd);
  const monthLeft = roundUsd(caps.monthlyUsd - spend.monthUsd);
  const remainingUsd = Math.max(0, Math.min(videoLeft, monthLeft));
  if (quoteUsd > videoLeft + 1e-9) return { ok: false, remainingUsd, which: "video" };
  if (quoteUsd > monthLeft + 1e-9) return { ok: false, remainingUsd, which: "month" };
  return { ok: true, remainingUsd };
}

export interface JobCost {
  status: "queued" | "running" | "completed" | "failed";
  quote_usd: number | string;
  cost_usd: number | string | null;
}

/** Spend of a set of jobs: the actual cost when known, else the quote (failed jobs are free). */
export function spendOf(jobs: readonly JobCost[]): number {
  return roundUsd(
    jobs.reduce((sum, j) => {
      if (j.status === "failed") return sum + Number(j.cost_usd ?? 0);
      return sum + Number(j.cost_usd ?? j.quote_usd);
    }, 0),
  );
}

/** "$0.00", "$2.53", "$0.056": two decimals, three under ten cents (sub-cent prices). */
export function usd(value: number): string {
  const v = Math.round(value * 1000) / 1000;
  if (v !== 0 && Math.abs(v) < 0.1 && Math.round(v * 100) !== v * 100) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/** Start of the UTC month `now` is in (the monthly cap's window). */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
