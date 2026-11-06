import { describe, expect, it } from "vitest";
import { ageLabel, clockTime, schedulerLine } from "./scheduler-status";

const NOW = new Date("2026-11-05T22:14:30Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe("schedulerLine", () => {
  it("is green with the check time while ticks arrive", () => {
    expect(schedulerLine(ago(0.5), NOW, "Europe/London")).toEqual({
      tone: "good",
      title: "Scheduler running",
      detail: "Checked at 22:14",
    });
    expect(schedulerLine(ago(3), NOW, "Europe/London").tone).toBe("good");
  });

  it("shows the time in the workspace timezone", () => {
    expect(schedulerLine(ago(1), NOW, "America/New_York").detail).toBe("Checked at 17:13");
  });

  it("is amber with the age once ticks stop", () => {
    expect(schedulerLine(ago(12), NOW, "Europe/London")).toEqual({
      tone: "warn",
      title: "Scheduler: last tick 12 min ago",
      detail: "Posts wait until it runs again.",
    });
  });

  it("is amber when it never ran", () => {
    expect(schedulerLine(null, NOW, null)).toMatchObject({
      tone: "warn",
      title: "Scheduler not running",
    });
  });
});

describe("ageLabel", () => {
  it.each([
    [0, "0 min"],
    [59 * 60_000, "59 min"],
    [61 * 60_000, "1 h"],
    [47 * 3_600_000, "47 h"],
    [72 * 3_600_000, "3 days"],
  ])("%d ms → %s", (ms, label) => {
    expect(ageLabel(ms)).toBe(label);
  });
});

describe("clockTime", () => {
  it("uses UTC without a timezone", () => {
    expect(clockTime(NOW, null)).toBe("22:14");
  });
});
