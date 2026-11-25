import { describe, expect, it } from "vitest";
import { cropRect, cropSize, gestureNote, normalise, stepFrame, timecode } from "./player";

describe("timecode and frames", () => {
  it("prints mm:ss.ff at the version's fps", () => {
    expect(timecode(0, 30)).toBe("00:00.00");
    expect(timecode(3.2, 30)).toBe("00:03.06");
    expect(timecode(61.5, 30)).toBe("01:01.15");
    expect(timecode(2, 25)).toBe("00:02.00");
    expect(timecode(59.99, 30)).toBe("00:59.29");
  });

  it("steps one frame at a time, to the middle of the frame, clamped to the video", () => {
    expect(stepFrame(0, 30, 1)).toBeCloseTo(1.5 / 30, 3);
    expect(stepFrame(1.5 / 30, 30, -1)).toBeCloseTo(0.5 / 30, 3);
    expect(stepFrame(0, 30, -1)).toBeCloseTo(0.5 / 30, 3);
    // 2 s at 30 fps is 60 frames: the last frame is 59.
    expect(stepFrame(1.99, 30, 5, 2)).toBeCloseTo(59.5 / 30, 3);
  });
});

describe("note boxes from pointer positions", () => {
  const rect = { left: 100, top: 50, width: 200, height: 400 };

  it("normalises to 0–1 from the frame's top left, clamped", () => {
    expect(normalise({ x: 200, y: 250 }, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalise({ x: 0, y: 900 }, rect)).toEqual({ x: 0, y: 1 });
  });

  it("is a moment for a click and a region for a drag, any direction", () => {
    expect(gestureNote({ x: 150, y: 100 }, { x: 151, y: 101 }, rect)).toEqual({ kind: "moment" });
    expect(gestureNote({ x: 260, y: 450 }, { x: 120, y: 250 }, rect)).toEqual({
      kind: "region",
      box: { x: 0.1, y: 0.5, w: 0.7, h: 0.5 },
    });
  });

  it("crops the box in pixels, at most 1280 px wide", () => {
    expect(cropRect({ x: 0.1, y: 0.5, w: 0.5, h: 0.25 }, 1080, 1920)).toEqual({
      sx: 108,
      sy: 960,
      sw: 540,
      sh: 480,
    });
    expect(cropRect(null, 720, 1280)).toEqual({ sx: 0, sy: 0, sw: 720, sh: 1280 });
    expect(cropSize(2160, 3840)).toEqual({ w: 1280, h: 2276 });
    expect(cropSize(540, 480)).toEqual({ w: 540, h: 480 });
  });
});
