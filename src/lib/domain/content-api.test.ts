import { describe, expect, it } from "vitest";
import {
  MAX_ACCOUNTS,
  accountRef,
  parseContentRequest,
  parseJsonBody,
  parseUploadRequest,
  pinnedAt,
} from "./content-api";

const UPLOAD = "6f1c1f9e-3b0a-4b8e-9a51-0c2d1e4f5a6b";
const TZ = "Europe/London";

function content(body: Record<string, unknown>) {
  return parseContentRequest(body, TZ);
}

describe("parseJsonBody", () => {
  it("reads a JSON object", () => {
    expect(parseJsonBody('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it.each([["[]"], ["3"], ["nope"], [""]])("refuses %j with 400", (text) => {
    const parsed = parseJsonBody(text);
    expect(parsed.ok || parsed.problem.status).toBe(400);
  });

  it("refuses bodies over 16 KB with 413", () => {
    const parsed = parseJsonBody(JSON.stringify({ caption: "x".repeat(17 * 1024) }));
    expect(parsed.ok || parsed.problem).toMatchObject({ status: 413, error: "too_large" });
  });
});

describe("parseUploadRequest", () => {
  it("takes a name, a size and an optional type", () => {
    expect(parseUploadRequest({ file_name: " render.mp4 ", bytes: 1000 })).toEqual({
      ok: true,
      value: { fileName: "render.mp4", contentType: "", bytes: 1000 },
    });
    expect(
      parseUploadRequest({ file_name: "a.mov", bytes: 5, content_type: "video/quicktime" }),
    ).toMatchObject({ ok: true, value: { contentType: "video/quicktime" } });
  });

  it.each([
    [{ bytes: 10 }],
    [{ file_name: "a.mp4" }],
    [{ file_name: "a.mp4", bytes: 0 }],
    [{ file_name: "a.mp4", bytes: 1.5 }],
    [{ file_name: "a.mp4", bytes: "10" }],
    [{ file_name: "a.mp4", bytes: 10, content_type: 3 }],
    [{ file_name: "x".repeat(256), bytes: 10 }],
  ])("refuses %j", (body) => {
    const parsed = parseUploadRequest(body);
    expect(parsed.ok || parsed.problem.error).toBe("invalid_request");
  });
});

describe("accountRef", () => {
  it("reads handles (with or without @, any case) and ids", () => {
    expect(accountRef("@Trip.App")).toEqual({ kind: "handle", handle: "trip.app" });
    expect(accountRef("codingjourney")).toEqual({ kind: "handle", handle: "codingjourney" });
    expect(accountRef(UPLOAD.toUpperCase())).toEqual({ kind: "id", id: UPLOAD });
  });

  it.each([[""], ["@"], ["a b"], ["../x"], ["x".repeat(31)], ["name,other"]])(
    "refuses %j",
    (value) => {
      expect(accountRef(value)).toBeNull();
    },
  );
});

describe("pinnedAt", () => {
  it("reads a time with a zone as is", () => {
    expect(pinnedAt("2026-11-08T12:00:00Z", TZ)?.toISOString()).toBe("2026-11-08T12:00:00.000Z");
    expect(pinnedAt("2026-11-08T12:00+01:00", TZ)?.toISOString()).toBe("2026-11-08T11:00:00.000Z");
  });

  it("reads a local time in the workspace timezone", () => {
    expect(pinnedAt("2026-07-08T12:00", TZ)?.toISOString()).toBe("2026-07-08T11:00:00.000Z");
  });

  it.each([["tomorrow"], ["2026-13-01T12:00"], ["2026-11-08"], [""]])("refuses %j", (v) => {
    expect(pinnedAt(v, TZ)).toBeNull();
  });
});

describe("parseContentRequest", () => {
  it("defaults to the next slot and an empty caption", () => {
    expect(content({ upload_id: UPLOAD, accounts: ["trip.app"] })).toEqual({
      ok: true,
      value: {
        uploadId: UPLOAD,
        caption: "",
        accounts: [{ kind: "handle", handle: "trip.app" }],
        timing: { kind: "queue" },
      },
    });
  });

  it("takes a pinned time and trims the caption", () => {
    const parsed = content({
      upload_id: UPLOAD,
      caption: "  Day 42  ",
      accounts: ["@a", UPLOAD],
      timing: { pinned_at: "2026-11-08T12:00" },
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        caption: "Day 42",
        accounts: [
          { kind: "handle", handle: "a" },
          { kind: "id", id: UPLOAD },
        ],
        timing: { kind: "pinned", at: new Date("2026-11-08T12:00:00Z") },
      },
    });
  });

  it("uses BC-14's message for a caption that's too long (422)", () => {
    const parsed = content({ upload_id: UPLOAD, accounts: ["a"], caption: "x".repeat(2201) });
    expect(parsed.ok || parsed.problem).toEqual({
      status: 422,
      error: "caption_too_long",
      message: "The caption is 2201 characters. Instagram allows 2200.",
    });
  });

  it.each([
    [{ accounts: ["a"] }, "upload_id"],
    [{ upload_id: "../../etc/passwd", accounts: ["a"] }, "upload_id"],
    [{ upload_id: UPLOAD }, "at least one account"],
    [{ upload_id: UPLOAD, accounts: [] }, "at least one account"],
    [{ upload_id: UPLOAD, accounts: [3] }, "isn't an account"],
    [{ upload_id: UPLOAD, accounts: Array(MAX_ACCOUNTS + 1).fill("a") }, "at most"],
    [{ upload_id: UPLOAD, accounts: ["a"], caption: 5 }, "caption"],
    [{ upload_id: UPLOAD, accounts: ["a"], timing: "now" }, "timing"],
    [{ upload_id: UPLOAD, accounts: ["a"], timing: { pinned_at: "soon" } }, "pinned_at"],
  ])("refuses %j (400)", (body, words) => {
    const parsed = content(body);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problem.status).toBe(400);
    expect(parsed.problem.message).toContain(words);
  });
});
