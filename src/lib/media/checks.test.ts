import { describe, expect, it } from "vitest";
import {
  checkFile,
  checkReel,
  checkVideo,
  isNineBySixteen,
  sizeLabel,
  videoContentType,
} from "./checks";

const MB = 1024 * 1024;
const file = { bytes: 12 * MB, mimeType: "video/mp4", fileName: "day-42.mp4" };
const reel = { width: 1080, height: 1920, durationS: 30, codec: "avc1" };

describe("Reels format checks", () => {
  it("accepts a 1080 × 1920, 30 s H.264 MP4", () => {
    expect(checkReel(file, reel)).toEqual([]);
  });

  it("rejects 1080 × 1350 with the documented message", () => {
    expect(checkVideo({ ...reel, width: 1080, height: 1350 })).toEqual([
      { code: "aspect", message: "This video is 1080 × 1350. Reels must be 9:16 (1080 × 1920)." },
    ]);
  });

  it("rejects 95 s and anything under 3 s", () => {
    expect(checkVideo({ ...reel, durationS: 95 })).toEqual([
      {
        code: "too_long",
        message: "This video is 95 seconds long. Reels must be 3 to 90 seconds.",
      },
    ]);
    expect(checkVideo({ ...reel, durationS: 2 })).toEqual([
      {
        code: "too_short",
        message: "This video is 2 seconds long. Reels must be 3 to 90 seconds.",
      },
    ]);
    expect(checkVideo({ ...reel, durationS: Number.NaN })[0]?.code).toBe("too_short");
    expect(checkVideo({ ...reel, durationS: 3 })).toEqual([]);
    expect(checkVideo({ ...reel, durationS: 90 })).toEqual([]);
  });

  it("rejects 60 MB with the documented message", () => {
    expect(checkFile({ ...file, bytes: 60 * MB })).toEqual([
      { code: "size", message: "This video is 60 MB. Reels can be up to 50 MB." },
    ]);
    expect(checkFile({ ...file, bytes: 50 * MB })).toEqual([]);
  });

  it("allows ±2% around 9:16", () => {
    expect(isNineBySixteen(1080, 1920)).toBe(true);
    expect(isNineBySixteen(720, 1280)).toBe(true);
    expect(isNineBySixteen(1080, 1900)).toBe(true); // 1.05% off
    expect(isNineBySixteen(1080, 1870)).toBe(false); // 2.7% off
    expect(isNineBySixteen(1920, 1080)).toBe(false);
    expect(isNineBySixteen(0, 1920)).toBe(false);
  });

  it("rejects other file types, judging by extension when there is no MIME type", () => {
    expect(checkFile({ ...file, mimeType: "video/webm", fileName: "a.webm" })[0]?.message).toBe(
      "This file is a .webm file. Reels must be an MP4 or MOV video.",
    );
    expect(checkFile({ ...file, mimeType: "", fileName: "a.MOV" })).toEqual([]);
    expect(checkFile({ ...file, mimeType: "video/quicktime", fileName: "clip" })).toEqual([]);
  });

  it("rejects codecs Instagram doesn't take, and wider than 1920 px", () => {
    expect(checkVideo({ ...reel, codec: "vp09" })[0]?.message).toMatch(/encoded as VP9/);
    expect(checkVideo({ ...reel, codec: "hvc1" })).toEqual([]);
    expect(checkVideo({ ...reel, codec: null })).toEqual([]);
    expect(checkVideo({ ...reel, width: 2160, height: 3840 })[0]?.code).toBe("width");
  });

  it("labels sizes and picks the Storage content type", () => {
    expect(sizeLabel(60 * MB)).toBe("60 MB");
    expect(sizeLabel(2.5 * MB)).toBe("2.5 MB");
    expect(sizeLabel(12_000)).toBe("12 KB");
    expect(videoContentType({ bytes: 1, mimeType: "", fileName: "x.mov" })).toBe("video/quicktime");
    expect(videoContentType({ bytes: 1, mimeType: "video/mp4" })).toBe("video/mp4");
  });
});
