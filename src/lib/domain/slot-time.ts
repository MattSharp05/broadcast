/** A daily posting slot as minutes after local midnight (0–1439). */
export type SlotMinutes = number;

const SLOT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Parses a slot stored as `HH:MM` (24-hour, workspace-local) into minutes after midnight.
 * Returns `null` for anything that isn't a valid `HH:MM` time.
 */
export function parseSlotTime(slot: string): SlotMinutes | null {
  const match = SLOT_PATTERN.exec(slot);
  if (!match) return null;
  const [, hours, minutes] = match;
  return Number(hours) * 60 + Number(minutes);
}

/** Formats minutes after midnight back into a zero-padded `HH:MM` slot. */
export function formatSlotTime(minutes: SlotMinutes): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
    throw new RangeError(`Slot minutes out of range: ${minutes}`);
  }
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}
