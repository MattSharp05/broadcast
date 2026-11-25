import { describe, expect, it } from "vitest";
import { FAKE_INTENTS, INTENT_MAX, clipIntent, fakeReply } from "./events";
import { stepsFor } from "./steps";

describe("intents", () => {
  it("keeps one line of at most 160 characters", () => {
    expect(clipIntent("  Rendering\nscene 3  ")).toBe("Rendering scene 3");
    const long = clipIntent("x".repeat(400));
    expect(long).toHaveLength(INTENT_MAX);
    expect(long?.endsWith("…")).toBe(true);
    expect(clipIntent("x".repeat(INTENT_MAX))).toBe("x".repeat(INTENT_MAX));
  });

  it("drops empty or non-text intents", () => {
    expect(clipIntent("   ")).toBeNull();
    expect(clipIntent(42)).toBeNull();
    expect(clipIntent(undefined)).toBeNull();
  });

  it("has a canned intent for every step and revise, each within the limit", () => {
    for (const step of [...stepsFor(true), "revise" as const]) {
      expect(FAKE_INTENTS[step].length).toBeLessThanOrEqual(INTENT_MAX);
    }
  });

  it("gives each note its own canned reply", () => {
    expect(fakeReply(2, "make the title bigger")).toContain("Note 2");
    expect(fakeReply(2, "make the title bigger")).toContain("make the title bigger");
  });
});
