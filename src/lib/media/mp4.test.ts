import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bufferReader, Mp4Error, probeMp4 } from "./mp4";

const FIXTURES = join(process.cwd(), "tests/fixtures/video");

async function probe(name: string) {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)));
  return probeMp4(bufferReader(bytes), bytes.length);
}

describe("probeMp4", () => {
  it("reads a 9:16 H.264 MP4 (moov first)", async () => {
    expect(await probe("reel-9x16.mp4")).toEqual({
      durationS: 4,
      width: 1080,
      height: 1920,
      codec: "avc1",
    });
  });

  it("reads files with moov at the end", async () => {
    const info = await probe("short-2s.mp4");
    expect(info).toMatchObject({ width: 1080, height: 1920, codec: "avc1" });
    expect(info.durationS).toBeCloseTo(2, 1);
  });

  it("reads a 4:5 video", async () => {
    expect(await probe("portrait-4x5.mp4")).toMatchObject({ width: 1080, height: 1350 });
  });

  it("applies a 90° rotation (phone videos stored landscape)", async () => {
    expect(await probe("rotated-9x16.mov")).toMatchObject({ width: 1080, height: 1920 });
  });

  it("only reads headers and the moov box", async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "short-2s.mp4")));
    let read = 0;
    await probeMp4((offset, length) => {
      read += length;
      return bufferReader(bytes)(offset, length);
    }, bytes.length);
    expect(read).toBeLessThan(bytes.length);
  });

  it("rejects files that aren't MP4/MOV", async () => {
    const text = new TextEncoder().encode("not a video at all, just some text");
    await expect(probeMp4(bufferReader(text), text.length)).rejects.toBeInstanceOf(Mp4Error);
    const empty = new Uint8Array(0);
    await expect(probeMp4(bufferReader(empty), 0)).rejects.toThrow(/isn't an MP4 or MOV/);
  });
});
