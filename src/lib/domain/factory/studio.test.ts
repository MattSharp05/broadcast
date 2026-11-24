import { describe, expect, it } from "vitest";
import { creditLines } from "./captions";
import {
  countHashtags,
  deliveryChecks,
  deliveryReady,
  type DeliveryCheckKey,
  type DeliveryInput,
} from "./delivery";
import {
  applyAnswers,
  batchFromDrafts,
  boxError,
  frameAt,
  nextNoteNumber,
  noteError,
} from "./notes";
import { nextVersionNumber, pruneSelection, versionLabel, type PrunableVersion } from "./versions";

describe("versions", () => {
  it("numbers versions from 1, then max + 1", () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([{ number: 1 }, { number: 3 }, { number: 2 }])).toBe(4);
    expect(versionLabel(4)).toBe("v4");
  });

  const v = (number: number, extra: Partial<PrunableVersion> = {}): PrunableVersion => ({
    id: `v${number}`,
    number,
    mediaId: `m${number}`,
    proxyPath: `p${number}`,
    posted: false,
    ...extra,
  });

  it("keeps posted versions whole and the newest 3 drafts' proxies", () => {
    const versions = [v(1, { posted: true }), v(2), v(3), v(4), v(5), v(6)];
    expect(pruneSelection(versions)).toEqual([
      { id: "v2", media: true, proxy: true },
      { id: "v3", media: true, proxy: true },
      { id: "v4", media: true, proxy: false },
      { id: "v5", media: true, proxy: false },
    ]);
  });

  it("keeps the chosen version whole and the newest version's full file", () => {
    const versions = [v(1), v(2, { chosen: true }), v(3), v(4), v(5), v(6)];
    const actions = pruneSelection(versions);
    expect(actions.find((a) => a.id === "v2")).toBeUndefined();
    expect(actions.find((a) => a.id === "v6")).toBeUndefined();
    expect(actions.find((a) => a.id === "v1")).toEqual({ id: "v1", media: true, proxy: true });
    expect(actions.find((a) => a.id === "v3")).toEqual({ id: "v3", media: true, proxy: true });
  });

  it("returns nothing for versions already pruned", () => {
    const pruned = [1, 2, 3, 4, 5].map((n) => v(n, { mediaId: null, proxyPath: null }));
    expect(pruneSelection(pruned)).toEqual([]);
    expect(pruneSelection([])).toEqual([]);
  });
});

describe("notes", () => {
  it("validates kinds: region needs a box, general has no time, moment has no box", () => {
    expect(noteError({ kind: "general", text: "Tighter overall" })).toBeNull();
    expect(noteError({ kind: "general", text: "x", tS: 2 })).toMatch(/isn't pinned to a time/);
    expect(noteError({ kind: "general", text: "x", box: { x: 0, y: 0, w: 1, h: 1 } })).toMatch(
      /no box/,
    );
    expect(noteError({ kind: "moment", text: "Cut here", tS: 4.2 }, 30)).toBeNull();
    expect(noteError({ kind: "moment", text: "Cut here" })).toMatch(/Pin the note/);
    expect(noteError({ kind: "moment", text: "x", tS: 31 }, 30)).toMatch(/past the end/);
    expect(
      noteError({ kind: "moment", text: "x", tS: 1, box: { x: 0, y: 0, w: 1, h: 1 } }),
    ).toMatch(/region note/);
    expect(noteError({ kind: "region", text: "Logo too big", tS: 3 })).toMatch(/needs a box/);
    expect(
      noteError({ kind: "region", text: "Logo", tS: 3, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 } }),
    ).toBeNull();
  });

  it("rejects empty or too long text", () => {
    expect(noteError({ kind: "general", text: "   " })).toMatch(/Write the note/);
    expect(noteError({ kind: "general", text: "a".repeat(2001) })).toMatch(/2000/);
  });

  it("checks boxes are normalised and inside the frame", () => {
    expect(boxError({ x: 0, y: 0, w: 1, h: 1 })).toBeNull();
    expect(boxError({ x: -0.1, y: 0, w: 0.5, h: 0.5 })).toMatch(/between 0 and 1/);
    expect(boxError({ x: 0.2, y: 0, w: 0, h: 0.5 })).toMatch(/width and a height/);
    expect(boxError({ x: 0.8, y: 0, w: 0.3, h: 0.5 })).toMatch(/fit inside/);
    expect(boxError({ x: 0, y: 0, w: "1", h: 1 })).toMatch(/between 0 and 1/);
    expect(boxError(null)).toMatch(/needs a box/);
  });

  it("maps a time to its frame and numbers notes per version", () => {
    expect(frameAt(0, 30)).toBe(0);
    expect(frameAt(2, 30)).toBe(60);
    expect(frameAt(0.1 * 3, 30)).toBe(9);
    expect(frameAt(1.999, 30)).toBe(59);
    expect(frameAt(1, 23.976)).toBe(23);
    expect(nextNoteNumber([])).toBe(1);
    expect(nextNoteNumber([{ number: 2 }, { number: 5 }])).toBe(6);
  });

  it("batches only drafts and refuses an empty batch", () => {
    expect(
      batchFromDrafts([
        { id: "a", status: "draft" },
        { id: "b", status: "sent" },
        { id: "c", status: "draft" },
      ]),
    ).toEqual({ ok: true, noteIds: ["a", "c"] });
    expect(batchFromDrafts([{ id: "b", status: "answered" }])).toEqual({
      ok: false,
      error: "There are no draft notes to send.",
    });
  });

  const sent = [
    { id: "n1", number: 1 },
    { id: "n2", number: 2 },
  ];

  it("accepts exactly one answer per sent note, each with a reply", () => {
    expect(
      applyAnswers(sent, [
        { noteId: "n2", status: "not_changed", reply: " Kept: it's the hook. " },
        { noteId: "n1", status: "answered", reply: "Trimmed 0.4 s." },
      ]),
    ).toEqual({
      ok: true,
      updates: [
        { noteId: "n1", status: "answered", reply: "Trimmed 0.4 s." },
        { noteId: "n2", status: "not_changed", reply: "Kept: it's the hook." },
      ],
    });
  });

  it("rejects missing, duplicate, unknown and reply-less answers", () => {
    const missing = applyAnswers(sent, [{ noteId: "n1", status: "answered", reply: "Done" }]);
    expect(missing).toEqual({ ok: false, errors: ["Note 2 has no answer."] });

    const duplicate = applyAnswers(sent, [
      { noteId: "n1", status: "answered", reply: "Done" },
      { noteId: "n1", status: "not_changed", reply: "Again" },
      { noteId: "n2", status: "answered", reply: "Done" },
    ]);
    expect(duplicate).toEqual({ ok: false, errors: ["Note 1 has more than one answer."] });

    const unknown = applyAnswers(sent, [
      { noteId: "n1", status: "answered", reply: "Done" },
      { noteId: "n2", status: "answered", reply: "Done" },
      { noteId: "zz", status: "answered", reply: "Done" },
    ]);
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.errors[0]).toMatch(/isn't a note in this batch/);

    const noReply = applyAnswers(sent, [
      { noteId: "n1", status: "answered", reply: " " },
      { noteId: "n2", status: "resolved", reply: "x" },
    ]);
    expect(noReply).toEqual({
      ok: false,
      errors: ["Note 1 needs a reply.", "Note 2: the answer must be answered or not_changed."],
    });
  });
});

describe("delivery checks", () => {
  const credits = creditLines({
    musicCredit: '"Floating Cities" by Kevin MacLeod (CC BY 4.0)',
    musicLicence: "CC BY 4.0",
    voiceCredit: null,
    avatar: true,
    imagery: [],
  });
  const good: DeliveryInput = {
    width: 1080,
    height: 1920,
    durationS: 42,
    bytes: 20 * 1024 * 1024,
    loudnessLufs: -14,
    truePeakDb: -1.5,
    caption: `How tides work. #space #moon\n\n${credits.join("\n")}`,
    credits,
    hashtags: ["science", "#Space"],
    avatar: true,
    aiFlag: true,
  };
  const failing = (input: DeliveryInput) =>
    deliveryChecks(input)
      .filter((c) => !c.ok)
      .map((c) => [c.key, c.message] as [DeliveryCheckKey, string]);

  it("passes a ready version", () => {
    const checks = deliveryChecks(good);
    expect(checks.map((c) => c.key)).toEqual([
      "aspect",
      "size",
      "duration",
      "caption_length",
      "credits",
      "hashtags",
      "ai_flag",
      "loudness",
      "true_peak",
    ]);
    expect(deliveryReady(checks)).toBe(true);
  });

  it("gives every failing check a message", () => {
    expect(failing({ ...good, width: 1920, height: 1080 })).toEqual([
      ["aspect", expect.stringMatching(/9:16/)],
    ]);
    expect(failing({ ...good, bytes: 60 * 1024 * 1024 })).toEqual([
      ["size", "This version is 60 MB. Reels can be up to 50 MB."],
    ]);
    expect(failing({ ...good, durationS: 2 })).toEqual([
      ["duration", expect.stringMatching(/3 to 90 seconds/)],
    ]);
    expect(failing({ ...good, durationS: 95 })).toEqual([
      ["duration", expect.stringMatching(/95 seconds long/)],
    ]);
    const long = `${good.caption}\n${"a".repeat(2200)}`;
    expect(failing({ ...good, caption: long })[0]).toEqual([
      "caption_length",
      expect.stringMatching(/Instagram allows 2200/),
    ]);
    expect(failing({ ...good, caption: "How tides work." })).toEqual([
      ["credits", expect.stringMatching(/missing credits: "Floating Cities".*AI-generated avatar/)],
    ]);
    const many = Array.from({ length: 31 }, (_, i) => `tag${i}`);
    expect(failing({ ...good, hashtags: many })).toEqual([
      ["hashtags", "There are 33 hashtags. Instagram allows 30."],
    ]);
    expect(failing({ ...good, aiFlag: false })).toEqual([
      ["ai_flag", expect.stringMatching(/flagged as AI-generated/)],
    ]);
    expect(failing({ ...good, loudnessLufs: -20 })).toEqual([
      ["loudness", "The mix is -20 LUFS. Aim for -16 to -12 LUFS."],
    ]);
    expect(failing({ ...good, loudnessLufs: -11 })).toEqual([
      ["loudness", expect.stringMatching(/-11 LUFS/)],
    ]);
    expect(failing({ ...good, truePeakDb: -0.5 })).toEqual([
      ["true_peak", "The true peak is -0.5 dBTP. Keep it at -1 dBTP or below."],
    ]);
  });

  it("skips loudness checks the render didn't report and the AI flag without an avatar", () => {
    const checks = deliveryChecks({
      ...good,
      loudnessLufs: null,
      truePeakDb: undefined,
      avatar: false,
      aiFlag: false,
    });
    expect(checks.map((c) => c.key)).not.toContain("loudness");
    expect(checks.map((c) => c.key)).not.toContain("true_peak");
    expect(deliveryReady(checks)).toBe(true);
  });

  it("counts hashtags once across the pack and the caption", () => {
    expect(countHashtags("Nice #Moon #moon #tides", ["moon", "#Space", " "])).toBe(3);
  });
});
