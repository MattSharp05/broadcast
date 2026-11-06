import { describe, expect, it } from "vitest";
import { ALL_TAGS, filterByTag, tagsOf } from "./tags";

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
