import { describe, expect, it } from "vitest";
import { addDays, timezoneOffsetMs, toLocalDate, zonedTimeToUtc } from "@/lib/domain/time";

const NY = "America/New_York";
const HOUR = 3_600_000;

describe("timezoneOffsetMs", () => {
  it.each([
    ["2026-01-15T12:00:00Z", NY, -5 * HOUR],
    ["2026-07-15T12:00:00Z", NY, -4 * HOUR],
    ["2026-07-15T12:00:00Z", "Asia/Kolkata", 5.5 * HOUR],
    ["2026-07-15T12:00:00.789Z", "UTC", 0],
  ])("at %s in %s is %i ms", (iso, tz, offset) => {
    expect(timezoneOffsetMs(Date.parse(iso), tz)).toBe(offset);
  });

  it("throws for an unknown timezone", () => {
    expect(() => timezoneOffsetMs(0, "Mars/Olympus_Mons")).toThrow(RangeError);
  });
});

describe("toLocalDate", () => {
  it("uses the timezone's calendar date, not UTC's", () => {
    // 03:00 UTC on 11 Nov is still 22:00 on 10 Nov in New York.
    expect(toLocalDate(new Date("2026-11-11T03:00:00Z"), NY)).toEqual({
      year: 2026,
      month: 11,
      day: 10,
    });
    expect(toLocalDate(new Date("2026-11-10T20:00:00Z"), "Asia/Tokyo")).toEqual({
      year: 2026,
      month: 11,
      day: 11,
    });
  });
});

describe("addDays", () => {
  it("rolls over months, years and leap days", () => {
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
    expect(addDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
    expect(addDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });
});

describe("zonedTimeToUtc", () => {
  it("converts an ordinary wall time", () => {
    expect(zonedTimeToUtc({ year: 2026, month: 11, day: 10 }, 9 * 60, NY).toISOString()).toBe(
      "2026-11-10T14:00:00.000Z",
    );
    expect(
      zonedTimeToUtc({ year: 2026, month: 7, day: 1 }, 9 * 60 + 15, "Asia/Kolkata").toISOString(),
    ).toBe("2026-07-01T03:45:00.000Z");
  });

  it("keeps 09:00 local on both sides of the fall-back change (1 Nov 2026)", () => {
    const at9 = (day: number) => zonedTimeToUtc({ year: 2026, month: 11, day }, 9 * 60, NY);
    expect(at9(1).toISOString()).toBe("2026-11-01T14:00:00.000Z"); // EST
    expect(at9(2).toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(zonedTimeToUtc({ year: 2026, month: 10, day: 31 }, 9 * 60, NY).toISOString()).toBe(
      "2026-10-31T13:00:00.000Z", // EDT
    );
  });

  it("resolves a repeated wall time (01:30 on 1 Nov 2026) to its first occurrence", () => {
    expect(zonedTimeToUtc({ year: 2026, month: 11, day: 1 }, 90, NY).toISOString()).toBe(
      "2026-11-01T05:30:00.000Z", // 01:30 EDT, not 01:30 EST (06:30Z)
    );
  });

  it("shifts a missing wall time (02:30 on 8 Mar 2026) forward by the gap to 03:30 EDT", () => {
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 8 }, 150, NY).toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    // The day after, 02:30 exists again.
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 9 }, 150, NY).toISOString()).toBe(
      "2026-03-09T06:30:00.000Z",
    );
  });
});
