import { describe, expect, it } from "vitest";
import { pastSlotTimes } from "./slots";

describe("pastSlotTimes", () => {
  it("walks back through earlier slots, newest first", () => {
    const now = new Date("2026-11-05T22:14:00Z"); // 22:14 in London (GMT)
    expect(
      pastSlotTimes(["09:00", "19:00"], "Europe/London", now, 3).map((d) => d.toISOString()),
    ).toEqual(["2026-11-05T19:00:00.000Z", "2026-11-05T09:00:00.000Z", "2026-11-04T19:00:00.000Z"]);
  });

  it("skips a slot at exactly now", () => {
    const now = new Date("2026-11-05T09:00:00Z");
    expect(pastSlotTimes(["09:00"], "Europe/London", now, 1)[0]?.toISOString()).toBe(
      "2026-11-04T09:00:00.000Z",
    );
  });

  it("keeps local slot times across a DST change", () => {
    // London leaves summer time on 25 Oct 2026: 07:00 local is 06:00Z before, 07:00Z after.
    const now = new Date("2026-10-26T12:00:00Z");
    expect(pastSlotTimes(["07:00"], "Europe/London", now, 3).map((d) => d.toISOString())).toEqual([
      "2026-10-26T07:00:00.000Z",
      "2026-10-25T07:00:00.000Z",
      "2026-10-24T06:00:00.000Z",
    ]);
  });

  it("returns nothing without slots", () => {
    expect(pastSlotTimes([], "Europe/London", new Date(), 3)).toEqual([]);
  });
});
