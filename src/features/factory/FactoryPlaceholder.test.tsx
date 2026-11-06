import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXAMPLE_BOARD } from "./example-board";
import { FactoryPlaceholder } from "./FactoryPlaceholder";

describe("EXAMPLE_BOARD", () => {
  it("has the four columns from the mockup, in order", () => {
    expect(EXAMPLE_BOARD.map((c) => c.name)).toEqual([
      "Ideas",
      "Scripting",
      "In video-editor",
      "Ready for the queue",
    ]);
    expect(EXAMPLE_BOARD.map((c) => c.ideas.length)).toEqual([3, 2, 1, 1]);
  });
});

describe("FactoryPlaceholder", () => {
  const html = renderToStaticMarkup(<FactoryPlaceholder />);

  it("explains the placeholder and how videos arrive today", () => {
    expect(html).toContain("Placeholder until v1");
    expect(html).toContain("Add content on the Workflow tab or through the API");
  });

  it("marks the board as examples", () => {
    expect(html).toContain('aria-label="Example board"');
    expect(html).toContain("They aren&#x27;t real.");
    expect(html.match(/data-example=""/g)).toHaveLength(7);
  });

  it("shows each column's count and code paths only where given", () => {
    expect(html).toContain("Ready for the queue<span");
    expect(html.match(/<code/g)).toHaveLength(3);
    expect(html).toContain("renders/driftship-tips-03.mp4");
  });
});
