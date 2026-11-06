import { describe, expect, it } from "vitest";
import {
  ALL_TAGS,
  TAGS_MAX,
  TAG_MAX_LENGTH,
  addTag,
  cleanTag,
  cleanTags,
  filterByTag,
  removeTag,
  tagCounts,
  tagSuggestions,
  tagsOf,
} from "./tags";

const accounts = [
  { id: "a", tags: ["Tech", "Build in public"] },
  { id: "b", tags: ["Sport"] },
  { id: "c", tags: ["Tech"] },
];

describe("tags", () => {
  it("lists every tag once, in first-seen order", () => {
    expect(tagsOf(accounts)).toEqual(["Tech", "Build in public", "Sport"]);
  });

  it("filters by tag; ALL_TAGS keeps everything", () => {
    expect(filterByTag(accounts, "Sport").map((a) => a.id)).toEqual(["b"]);
    expect(filterByTag(accounts, "Tech").map((a) => a.id)).toEqual(["a", "c"]);
    expect(filterByTag(accounts, ALL_TAGS)).toHaveLength(3);
    expect(filterByTag(accounts, "Nope")).toEqual([]);
  });
});

describe("tag edits", () => {
  it("counts accounts per tag", () => {
    expect([...tagCounts(accounts)]).toEqual([
      ["Tech", 2],
      ["Build in public", 1],
      ["Sport", 1],
    ]);
  });

  it("adds a cleaned tag once, ignoring case", () => {
    expect(addTag(["App"], "  Launch  ")).toEqual(["App", "Launch"]);
    expect(addTag(["App"], "app")).toBeNull();
    expect(addTag(["App"], "   ")).toBeNull();
    expect(addTag(["App"], "a   b")).toEqual(["App", "a b"]);
    expect(
      addTag(
        Array.from({ length: TAGS_MAX }, (_, i) => `t${i}`),
        "more",
      ),
    ).toBeNull();
    expect(cleanTag("x".repeat(60))).toHaveLength(TAG_MAX_LENGTH);
    expect(addTag(["App"], "tech", ["Tech", "Sport"])).toEqual(["App", "Tech"]);
  });

  it("removes a tag", () => {
    expect(removeTag(["App", "Product"], "App")).toEqual(["Product"]);
  });

  it("cleans a whole list for storage", () => {
    expect(cleanTags([" Tech", "tech", "", "Sport"])).toEqual(["Tech", "Sport"]);
    expect(cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(TAGS_MAX);
  });

  it("suggests tags in use, then the defaults, minus the account's own", () => {
    expect(tagSuggestions(["Tech", "Launch"], ["tech"])).toEqual([
      "Launch",
      "AI avatar",
      "App",
      "Explainers",
      "Sport",
    ]);
  });
});
