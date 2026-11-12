import type { StatusTone } from "@/components/StatusDot";

export const STATUS_WORD: Record<string, string> = {
  draft: "Draft",
  running: "In production",
  waiting: "Waiting for you",
  ready: "Ready to schedule",
  scheduled: "Queued",
  failed: "Failed",
};

export const STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  running: "accent",
  waiting: "warn",
  ready: "good",
  scheduled: "accent",
  failed: "bad",
};

export const STEP_WORD: Record<string, string> = {
  pending: "Not started",
  running: "Running",
  waiting: "Waiting for you",
  approved: "Approved",
  failed: "Failed",
  skipped: "Skipped",
};

export const STEP_TONE: Record<string, StatusTone> = {
  pending: "neutral",
  running: "accent",
  waiting: "warn",
  approved: "good",
  failed: "bad",
  skipped: "neutral",
};
