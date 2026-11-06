import { describe, expect, it } from "vitest";
import { formatSlotTime, parseSlotTime } from "@/lib/domain/slot-time";

describe("parseSlotTime", () => {
  it.each([
    ["00:00", 0],
    ["09:30", 570],
    ["23:59", 1439],
  ])("parses %s to %i minutes", (slot, minutes) => {
    expect(parseSlotTime(slot)).toBe(minutes);
  });

  it.each(["24:00", "9:30", "09:60", "", "0930", " 09:30"])("rejects %j", (slot) => {
    expect(parseSlotTime(slot)).toBeNull();
  });
});

describe("formatSlotTime", () => {
  it("round-trips with parseSlotTime", () => {
    for (const slot of ["00:00", "07:05", "18:45", "23:59"]) {
      const minutes = parseSlotTime(slot);
      expect(minutes).not.toBeNull();
      expect(formatSlotTime(minutes ?? -1)).toBe(slot);
    }
  });

  it.each([-1, 1440, 1.5])("throws for %d", (minutes) => {
    expect(() => formatSlotTime(minutes)).toThrow(RangeError);
  });
});
