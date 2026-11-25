import { describe, expect, it } from "vitest";
import { boardSeconds, estimateCards, parseCards, reorder } from "./board";

const stills = [1, 2, 3].map((n) => ({ url: `/s${n}.svg`, scene: `s${n}`, caption: `Scene ${n}` }));

describe("board", () => {
  it("estimates each card's seconds from its share of the script lines", () => {
    // Six lines of 5 words (2 s each at 2.5 words/s): two lines per still.
    const lines = Array.from({ length: 6 }, () => ({ text: "one two three four five" }));
    const cards = estimateCards(stills, lines);
    expect(cards.map((c) => c.seconds)).toEqual([4, 4, 4]);
    expect(cards.every((c) => c.estimated)).toBe(true);
    expect(cards[0]).toMatchObject({ scene: "s1", text: "Scene 1", still: "/s1.svg" });
    // Fewer lines than stills: every still still gets a line's worth.
    expect(estimateCards(stills, [{ text: "a b c d e" }]).map((c) => c.seconds)).toEqual([2, 2, 2]);
    // No script: the stills share the fallback length.
    expect(boardSeconds(estimateCards(stills, [], 60))).toBe(60);
  });

  it("keeps only valid cards from a session", () => {
    expect(parseCards("x")).toBeNull();
    expect(
      parseCards([
        { scene: "s1", text: "Hook", seconds: 3, still: "storage:x" },
        { scene: "s2", text: "Bad", seconds: 0 },
      ]),
    ).toEqual([{ scene: "s1", text: "Hook", seconds: 3, still: "storage:x" }]);
  });

  it("reorders with contiguous positions", () => {
    const items = ["a", "b", "c", "d"].map((id) => ({ id }));
    expect(reorder(items, 3, 2).map((c) => `${c.id}${c.position}`)).toEqual([
      "a0",
      "b1",
      "d2",
      "c3",
    ]);
    expect(reorder(items, 0, 99).map((c) => c.id)).toEqual(["b", "c", "d", "a"]);
    expect(reorder(items, 9, 0).map((c) => c.position)).toEqual([0, 1, 2, 3]);
  });
});
