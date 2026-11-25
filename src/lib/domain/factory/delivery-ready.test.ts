import { describe, expect, it } from "vitest";
import { CAPTION_MAX } from "./captions";
import { addHashtags, deliveryChecks, normaliseHashtag, postedCaption } from "./delivery";

describe("hashtags on the Ready to post tab", () => {
  it("normalises a tag: no #, letters/digits/underscores only", () => {
    expect(normaliseHashtag("#Tides")).toBe("Tides");
    expect(normaliseHashtag("  ##moon_facts ")).toBe("moon_facts");
    expect(normaliseHashtag("two words")).toBeNull();
    expect(normaliseHashtag("#")).toBeNull();
    expect(normaliseHashtag("café")).toBe("café");
  });

  it("adds typed tags split on spaces, commas and #, without duplicates", () => {
    expect(addHashtags(["tides"], "#Tides, #moon science  #moon")).toEqual([
      "tides",
      "moon",
      "science",
    ]);
    expect(addHashtags([], "!!! ,,")).toEqual([]);
  });

  it("assembles caption + hashtags and counts the result against 2,200", () => {
    const posted = postedCaption("Why tides happen.\n\nMusic: x", ["tides", "moon"]);
    expect(posted).toBe("Why tides happen.\n\nMusic: x\n\n#tides #moon");
    const long = "a".repeat(CAPTION_MAX - 5);
    const checks = deliveryChecks({
      width: 1080,
      height: 1920,
      durationS: 60,
      bytes: 1000,
      caption: long,
      credits: [],
      hashtags: ["tides"],
      avatar: false,
      aiFlag: false,
      coverChosen: true,
    });
    expect(checks.find((c) => c.key === "caption_length")?.ok).toBe(false);
    expect(checks.find((c) => c.key === "cover")?.ok).toBe(true);
  });

  it("asks for a cover only when the tab says whether one is chosen", () => {
    const base = {
      width: 1080,
      height: 1920,
      durationS: 60,
      bytes: 1000,
      caption: "Hi",
      credits: [],
      hashtags: [],
      avatar: false,
      aiFlag: false,
    };
    expect(deliveryChecks(base).some((c) => c.key === "cover")).toBe(false);
    expect(
      deliveryChecks({ ...base, coverChosen: false }).find((c) => c.key === "cover"),
    ).toMatchObject({
      ok: false,
      message: "Pick a frame for the cover.",
    });
  });
});
