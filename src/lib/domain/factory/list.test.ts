import { describe, expect, it } from "vitest";
import { cardLine, inFilter, type ListFacts } from "./list";

const base: ListFacts = {
  status: "ready",
  newestVersion: null,
  openNotes: 0,
  answersToRead: 0,
  batchOpen: false,
  readyPack: false,
  post: null,
  stepLabel: null,
};

describe("studio list cards", () => {
  it("says what state each video is in", () => {
    expect(cardLine({ ...base, newestVersion: 3, openNotes: 2 })).toBe("v3, 2 notes open");
    expect(cardLine({ ...base, newestVersion: 3, answersToRead: 1 })).toBe("v3, 1 answer to read");
    expect(cardLine({ ...base, newestVersion: 3, readyPack: true })).toBe("Ready to post");
    expect(cardLine({ ...base, post: { status: "queued", when: "Tue 18:00" } })).toBe(
      "Scheduled for Tue 18:00",
    );
    expect(cardLine({ ...base, status: "waiting", stepLabel: "Script" })).toBe(
      "Script waits for you",
    );
  });

  it("puts each video under the right filters", () => {
    const waiting = { ...base, status: "waiting" };
    const answered = { ...base, newestVersion: 3, answersToRead: 2 };
    const ready = { ...base, readyPack: true };
    const running = { ...base, status: "running" };
    const queued = {
      ...base,
      status: "scheduled",
      readyPack: true,
      post: { status: "queued", when: "x" },
    };
    const posted = { ...base, status: "scheduled", post: { status: "published", when: "x" } };
    const needsMe = [waiting, answered, ready, running, queued, posted].map((f) =>
      inFilter("needs_me", f),
    );
    expect(needsMe).toEqual([true, true, true, false, false, false]);
    expect(inFilter("in_progress", running)).toBe(true);
    expect(inFilter("in_progress", { ...base, batchOpen: true })).toBe(true);
    expect(inFilter("scheduled", queued)).toBe(true);
    expect(inFilter("posted", posted)).toBe(true);
    expect(inFilter("scheduled", posted)).toBe(false);
  });
});
