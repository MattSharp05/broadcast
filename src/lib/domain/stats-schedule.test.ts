import { describe, expect, it } from "vitest";
import {
  dueSnapshots,
  followerDay,
  followersDue,
  statDueAt,
  type StatRowState,
} from "./stats-schedule";

const PUBLISHED = new Date("2026-11-05T10:00:00Z");
const at = (hours: number) => new Date(PUBLISHED.getTime() + hours * 3_600_000);
const untaken = (...offsets: StatRowState["offset"][]): StatRowState[] =>
  offsets.map((offset) => ({ offset, takenAt: null }));
const ALL = untaken("1h", "6h", "24h", "48h", "7d");

describe("statDueAt", () => {
  it("is +1 h, +6 h, +24 h, +48 h and +7 days after publishing", () => {
    expect(statDueAt(PUBLISHED, "1h")).toEqual(at(1));
    expect(statDueAt(PUBLISHED, "6h")).toEqual(at(6));
    expect(statDueAt(PUBLISHED, "24h")).toEqual(at(24));
    expect(statDueAt(PUBLISHED, "48h")).toEqual(at(48));
    expect(statDueAt(PUBLISHED, "7d")).toEqual(at(168));
  });
});

describe("dueSnapshots", () => {
  it("nothing is due before the first hour", () => {
    expect(dueSnapshots({ publishedAt: PUBLISHED, rows: ALL, now: at(0.99) })).toEqual({
      take: null,
      missed: [],
    });
  });

  it("the 1 h snapshot is due at exactly one hour", () => {
    expect(dueSnapshots({ publishedAt: PUBLISHED, rows: ALL, now: at(1) })).toEqual({
      take: "1h",
      missed: [],
    });
  });

  it("a taken snapshot is not due again; the next one waits for its time", () => {
    const rows: StatRowState[] = [
      { offset: "1h", takenAt: at(1) },
      ...untaken("6h", "24h", "48h", "7d"),
    ];
    expect(dueSnapshots({ publishedAt: PUBLISHED, rows, now: at(5) }).take).toBeNull();
    expect(dueSnapshots({ publishedAt: PUBLISHED, rows, now: at(6) })).toEqual({
      take: "6h",
      missed: [],
    });
  });

  it("after downtime takes only the latest due offset; the missed ones come in order", () => {
    const rows: StatRowState[] = [
      { offset: "1h", takenAt: at(1) },
      ...untaken("6h", "24h", "48h", "7d"),
    ];
    expect(dueSnapshots({ publishedAt: PUBLISHED, rows, now: at(50) })).toEqual({
      take: "48h",
      missed: ["6h", "24h"],
    });
  });

  it("a long outage before the first refresh: 7 days taken, the rest missed", () => {
    expect(dueSnapshots({ publishedAt: PUBLISHED, rows: ALL, now: at(400) })).toEqual({
      take: "7d",
      missed: ["1h", "6h", "24h", "48h"],
    });
  });

  it("an offset without a row counts as not taken", () => {
    expect(dueSnapshots({ publishedAt: PUBLISHED, rows: [], now: at(7) })).toEqual({
      take: "6h",
      missed: ["1h"],
    });
  });

  it("all five taken: nothing left", () => {
    const rows = ALL.map((r) => ({ ...r, takenAt: at(200) }));
    expect(dueSnapshots({ publishedAt: PUBLISHED, rows, now: at(500) })).toEqual({
      take: null,
      missed: [],
    });
  });
});

describe("followers", () => {
  it("the day is the workspace's local date", () => {
    const lateEvening = new Date("2026-11-05T23:30:00Z");
    expect(followerDay(lateEvening, "UTC")).toBe("2026-11-05");
    expect(followerDay(lateEvening, "Europe/Berlin")).toBe("2026-11-06");
    expect(followerDay(lateEvening, "America/New_York")).toBe("2026-11-05");
  });

  it("is due once a day per account", () => {
    const now = new Date("2026-11-06T09:00:00Z");
    expect(followersDue(null, now, "UTC")).toBe(true);
    expect(followersDue("2026-11-05", now, "UTC")).toBe(true);
    expect(followersDue("2026-11-06", now, "UTC")).toBe(false);
  });
});
