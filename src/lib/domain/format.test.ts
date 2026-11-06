import { describe, expect, it } from "vitest";
import {
  ago,
  compactCount,
  dayLabel,
  duration,
  inFrom,
  nowLabel,
  sameLocalDay,
  shortCountdown,
  shortDate,
  statCount,
  whenLabel,
} from "./format";

const NOW = new Date("2026-11-05T22:14:00Z"); // Thu 5 Nov, 22:14 in London (GMT)
const LONDON = "Europe/London";

describe("format", () => {
  it("labels days relative to now in the workspace timezone", () => {
    expect(whenLabel(new Date("2026-11-05T19:00:00Z"), NOW, LONDON)).toBe("Today, 19:00");
    expect(whenLabel(new Date("2026-11-06T09:00:00Z"), NOW, LONDON)).toBe("Tomorrow, 09:00");
    expect(whenLabel(new Date("2026-11-04T18:30:00Z"), NOW, LONDON)).toBe("Yesterday, 18:30");
    expect(whenLabel(new Date("2026-11-07T12:00:00Z"), NOW, LONDON)).toBe("Sat 7 Nov, 12:00");
  });

  it("uses the timezone's calendar day, not UTC's", () => {
    // 23:30 UTC on the 5th is already the 6th in Berlin.
    expect(dayLabel(new Date("2026-11-05T23:30:00Z"), NOW, "Europe/Berlin")).toBe("Tomorrow");
    expect(sameLocalDay(new Date("2026-11-05T23:30:00Z"), NOW, LONDON)).toBe(true);
  });

  it("prints the now tag with the date", () => {
    expect(nowLabel(NOW, LONDON)).toBe("Thu 5 Nov, 22:14");
  });

  it("formats countdowns short and long", () => {
    const at = new Date("2026-11-06T09:00:00Z");
    expect(shortCountdown(at, NOW)).toBe("10h 46m");
    expect(shortCountdown(new Date("2026-11-05T22:30:00Z"), NOW)).toBe("16m");
    expect(shortCountdown(new Date("2026-11-08T01:14:00Z"), NOW)).toBe("2d 3h");
    expect(inFrom(at, NOW)).toBe("in 10 h 46 min");
    expect(inFrom(new Date("2026-11-05T22:20:00Z"), NOW)).toBe("in 6 min");
    expect(inFrom(new Date("2026-11-07T22:14:00Z"), NOW)).toBe("in 2 days");
    expect(inFrom(NOW, NOW)).toBe("now");
  });

  it("compacts counts and durations", () => {
    expect(compactCount(312)).toBe("312");
    expect(compactCount(1240)).toBe("1.2K");
    expect(compactCount(2000)).toBe("2K");
    expect(compactCount(54_100)).toBe("54K");
    expect(compactCount(1_300_000)).toBe("1.3M");
    expect(duration(42)).toBe("0:42");
    expect(duration(65.4)).toBe("1:05");
  });

  it("shows a stat Instagram doesn't report as a dash", () => {
    expect(statCount(null)).toBe("—");
    expect(statCount(0)).toBe("0");
    expect(statCount(1240)).toBe("1.2K");
  });

  it("says how long ago, and short dates", () => {
    expect(ago(NOW, NOW)).toBe("just now");
    expect(ago(new Date("2026-11-05T22:02:00Z"), NOW)).toBe("12 min ago");
    expect(ago(new Date("2026-11-05T19:00:00Z"), NOW)).toBe("3 h ago");
    expect(ago(new Date("2026-11-04T20:00:00Z"), NOW)).toBe("1 day ago");
    expect(ago(new Date("2026-11-02T22:14:00Z"), NOW)).toBe("3 days ago");
    expect(shortDate(new Date("2026-11-02T10:00:00Z"), LONDON)).toBe("2 Nov");
  });
});
