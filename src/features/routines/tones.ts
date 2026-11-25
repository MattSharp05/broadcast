import type { StatusTone } from "@/components/StatusDot";
import type { RoutineStatus, SlotStatus } from "@/lib/domain/routines";

/** Status colours (colour only for state, DESIGN.md). */
export const SLOT_TONES: Record<SlotStatus, StatusTone> = {
  open: "neutral",
  planned: "neutral",
  building: "accent",
  review: "warn",
  scheduled: "accent",
  posted: "good",
  failed: "bad",
  missed: "warn",
  skipped: "neutral",
};

export const ROUTINE_TONES: Record<RoutineStatus, StatusTone> = {
  draft: "neutral",
  planning: "accent",
  planned: "warn",
  running: "good",
  paused: "warn",
  done: "neutral",
  cancelled: "neutral",
};
