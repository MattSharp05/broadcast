import { describe, expect, it } from "vitest";
import { floorToMinute, nowFor, parseNowParam } from "./clock";

const real = new Date("2026-11-06T10:00:00Z");

describe("nowFor", () => {
  it("uses the Sandbox's fixed clock when set", () => {
    expect(nowFor({ kind: "sandbox", clockOverride: "2026-11-05T22:14:00Z" }, real)).toEqual(
      new Date("2026-11-05T22:14:00Z"),
    );
  });

  it("uses real time for the Sandbox without a fixed clock", () => {
    expect(nowFor({ kind: "sandbox", clockOverride: null }, real)).toBe(real);
  });

  it("always uses real time for Live", () => {
    expect(nowFor({ kind: "live", clockOverride: "2026-11-05T22:14:00Z" }, real)).toBe(real);
  });

  it("ignores a broken override", () => {
    expect(nowFor({ kind: "sandbox", clockOverride: "nonsense" }, real)).toBe(real);
  });
});

describe("parseNowParam", () => {
  it.each([
    ["2026-11-05T22:14:00Z", "2026-11-05T22:14:00.000Z"],
    ["2026-11-05T22:14Z", "2026-11-05T22:14:00.000Z"],
    ["2026-11-05T22:14:00.500Z", "2026-11-05T22:14:00.500Z"],
    ["2026-11-05T23:14:00+01:00", "2026-11-05T22:14:00.000Z"],
  ])("accepts %s", (input, iso) => {
    expect(parseNowParam(input)?.toISOString()).toBe(iso);
  });

  it.each([null, undefined, "", "now", "2026-11-05", "2026-11-05T22:14:00", "20026-11-05T22:14Z"])(
    "rejects %s",
    (input) => {
      expect(parseNowParam(input)).toBeNull();
    },
  );
});

it("floorToMinute drops seconds", () => {
  expect(floorToMinute(new Date("2026-11-05T22:14:59.999Z")).toISOString()).toBe(
    "2026-11-05T22:14:00.000Z",
  );
});
