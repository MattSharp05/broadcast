import { describe, expect, it } from "vitest";
import { isUploadOf, uploadPaths } from "./videos";

const WS = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000001";
const ID = "8a6e0f8e-3f2b-4b8e-9a51-0c2f3c6f2d11";

describe("upload paths", () => {
  it("puts an upload's files under the workspace", () => {
    expect(uploadPaths(WS, ID, "video/mp4")).toEqual({
      video: `${WS}/videos/${ID}.mp4`,
      thumbnail: `${WS}/thumbnails/${ID}.jpg`,
    });
    expect(uploadPaths(WS, ID, "video/quicktime").video).toBe(`${WS}/videos/${ID}.mov`);
  });

  it("accepts only one upload's own paths in this workspace", () => {
    const p = uploadPaths(WS, ID, "video/mp4");
    expect(isUploadOf(WS, p.video, p.thumbnail)).toBe(true);
    expect(isUploadOf(WS, p.video, null)).toBe(true);
    expect(isUploadOf(OTHER, p.video, p.thumbnail)).toBe(false);
    // A thumbnail from another upload, or a video where the thumbnail goes.
    const q = uploadPaths(WS, "11111111-2222-4333-8444-555555555555", "video/mp4");
    expect(isUploadOf(WS, p.video, q.thumbnail)).toBe(false);
    expect(isUploadOf(WS, p.video, q.video)).toBe(false);
    expect(isUploadOf(WS, p.thumbnail, null)).toBe(false);
    expect(isUploadOf(WS, `${WS}/videos/../x.mp4`, null)).toBe(false);
    expect(isUploadOf(WS, `sandbox/canvas-busy/${ID}.mp4`, null)).toBe(false);
  });
});
