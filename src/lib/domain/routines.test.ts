import { describe, expect, it } from "vitest";
import {
  cadenceLabel,
  duplicateOf,
  fakePlan,
  genreSequence,
  layoutSlots,
  missedSlots,
  mixCounts,
  nextForBuild,
  parseReview,
  fromLocalInput,
  toLocalInput,
  parseConfig,
  planIssues,
  postTimeFor,
  routineFinished,
  scheduleIssues,
  slotsToStart,
  type ScheduleInput,
  type SlotState,
} from "./routines";

const base: ScheduleInput = {
  startsAt: new Date("2026-11-26T00:00:00Z"),
  endsAt: new Date("2026-11-29T00:00:00Z"),
  postsPerDay: 10,
  windowStart: "09:00",
  windowEnd: "19:00",
  timezone: "UTC",
  accountIds: ["a"],
  leadMinutes: 180,
};

describe("layoutSlots", () => {
  it("spreads posts evenly over each day of the window", () => {
    const slots = layoutSlots(base);
    expect(slots).toHaveLength(30);
    expect(slots[0]?.postAt.toISOString()).toBe("2026-11-26T09:00:00.000Z");
    expect(slots[1]?.postAt.toISOString()).toBe("2026-11-26T10:00:00.000Z");
    expect(slots[9]?.postAt.toISOString()).toBe("2026-11-26T18:00:00.000Z");
    expect(slots[10]?.postAt.toISOString()).toBe("2026-11-27T09:00:00.000Z");
    expect(slots[0]?.buildAt.toISOString()).toBe("2026-11-26T06:00:00.000Z");
  });

  it("keeps only times inside the time frame", () => {
    const slots = layoutSlots({ ...base, startsAt: new Date("2026-11-26T15:30:00Z") });
    expect(slots[0]?.postAt.toISOString()).toBe("2026-11-26T16:00:00.000Z");
    expect(slots).toHaveLength(3 + 20);
  });

  it("interleaves accounts so positions follow time", () => {
    const slots = layoutSlots({ ...base, accountIds: ["a", "b"], postsPerDay: 2 });
    expect(slots.map((s) => s.accountId).slice(0, 4)).toEqual(["a", "b", "a", "b"]);
    expect(slots.map((s) => s.position)).toEqual(slots.map((_, i) => i + 1));
  });

  it("uses the workspace timezone", () => {
    const slots = layoutSlots({
      ...base,
      timezone: "Europe/Madrid",
      postsPerDay: 1,
      startsAt: new Date("2026-11-26T00:00:00Z"),
      endsAt: new Date("2026-11-27T00:00:00Z"),
    });
    expect(slots.map((s) => s.postAt.toISOString())).toEqual(["2026-11-26T08:00:00.000Z"]);
  });

  it("can post every hour all day", () => {
    const slots = layoutSlots({
      ...base,
      postsPerDay: 24,
      windowStart: "00:00",
      windowEnd: "24:00",
      endsAt: new Date("2026-11-28T00:00:00Z"),
    });
    expect(slots).toHaveLength(48);
    expect(slots[23]?.postAt.toISOString()).toBe("2026-11-26T23:00:00.000Z");
  });
});

describe("scheduleIssues", () => {
  it("accepts a sensible routine", () => {
    expect(scheduleIssues(base)).toEqual([]);
  });
  it("refuses more posts a day than the quota leaves", () => {
    expect(scheduleIssues({ ...base, postsPerDay: 30 })[0]?.field).toBe("postsPerDay");
  });
  it("refuses a window that ends before it starts, and no accounts", () => {
    const fields = scheduleIssues({ ...base, windowStart: "20:00", accountIds: [] }).map(
      (i) => i.field,
    );
    expect(fields).toEqual(["windowEnd", "accounts"]);
  });
});

describe("cadenceLabel", () => {
  it("says how often a post goes out", () => {
    expect(cadenceLabel(10, "09:00", "21:00")).toBe("Every 1 h 12 min");
    expect(cadenceLabel(24, "00:00", "24:00")).toBe("Every 1 h");
    expect(cadenceLabel(1, "09:00", "21:00")).toBe("Once a day");
  });
});

describe("genre mix", () => {
  const mix = [
    { genre: "brainteaser", weight: 2 },
    { genre: "explainer", weight: 3 },
  ];
  it("splits videos by weight", () => {
    expect(Object.fromEntries(mixCounts(mix, 10))).toEqual({ brainteaser: 4, explainer: 6 });
    const seven = mixCounts(mix, 7);
    expect((seven.get("brainteaser") ?? 0) + (seven.get("explainer") ?? 0)).toBe(7);
  });
  it("interleaves genres", () => {
    const seq = genreSequence(mix, 5);
    expect(seq.filter((g) => g === "explainer")).toHaveLength(3);
    expect(seq.slice(0, 2).sort()).toEqual(["brainteaser", "explainer"]);
  });
  it("has no genres without a mix", () => {
    expect(genreSequence([], 2)).toEqual([null, null]);
  });
});

describe("duplicateOf", () => {
  const past = [
    { title: "Why the sky is blue", idea: "Rayleigh scattering of sunlight in the air." },
    { title: "How tides work", idea: "The moon's gravity pulls the oceans." },
  ];
  it("finds the same title or the same idea", () => {
    expect(duplicateOf({ title: "why the sky is blue", idea: "x" }, past)?.title).toBe(
      "Why the sky is blue",
    );
    expect(
      duplicateOf(
        { title: "The blue sky", idea: "Sunlight scattering in the air makes the sky blue." },
        past,
      )?.title,
    ).toBe("Why the sky is blue");
  });
  it("lets a new idea through", () => {
    expect(
      duplicateOf(
        { title: "How noise cancelling works", idea: "Mirror waves cancel sound." },
        past,
      ),
    ).toBeNull();
  });
});

describe("planIssues", () => {
  const libraries = { styles: ["handmade-2d", "luminous-3d"], voices: ["v1", "v2"], music: ["m1"] };
  const config = parseConfig({ voices: ["v1"], genreMix: [{ genre: "explainer", weight: 1 }] });
  const brief = (over: Record<string, unknown> = {}) => ({
    title: "How noise cancelling works",
    idea: "Headphones play the mirror wave of outside sound so it cancels out.",
    genre: "explainer",
    hook: "Sound vs sound.",
    style: "handmade-2d",
    voiceKey: "v1",
    musicKey: "m1",
    notes: "",
    ...over,
  });
  it("accepts a complete plan", () => {
    expect(
      planIssues({
        slotIds: ["s1"],
        briefs: [{ slotId: "s1", brief: brief() }],
        config,
        libraries,
        past: [],
      }),
    ).toEqual([]);
  });
  it("reports missing slots, disallowed keys and repeats", () => {
    const issues = planIssues({
      slotIds: ["s1", "s2", "s3"],
      briefs: [
        { slotId: "s1", brief: brief({ voiceKey: "v2" }) },
        { slotId: "s2", brief: brief({ title: "Noise cancelling, how it works" }) },
      ],
      config,
      libraries,
      past: [],
    }).map((i) => `${i.slotId}: ${i.message.split(".")[0]}`);
    expect(issues).toEqual([
      's1: voice_key "v2" isn\'t allowed',
      's2: Repeats another slot in this plan: "How noise cancelling works"',
      "s3: This slot has no brief",
    ]);
  });
});

describe("running", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const slot = (
    id: string,
    status: SlotState["status"],
    postAt: string,
    buildAt: string,
  ): SlotState => ({
    id,
    status,
    postAt: new Date(postAt),
    buildAt: new Date(buildAt),
  });
  it("starts due slots, earliest first, within the parallel limit", () => {
    const slots = [
      slot("b", "planned", "2026-11-26T15:00:00Z", "2026-11-26T12:00:00Z"),
      slot("a", "planned", "2026-11-26T14:00:00Z", "2026-11-26T11:00:00Z"),
      slot("later", "planned", "2026-11-26T20:00:00Z", "2026-11-26T17:00:00Z"),
      slot("x", "building", "2026-11-26T13:00:00Z", "2026-11-26T10:00:00Z"),
    ];
    expect(slotsToStart({ slots, now, maxParallel: 2 }).map((s) => s.id)).toEqual(["a"]);
    expect(slotsToStart({ slots, now, maxParallel: 3 }).map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("misses slots past their grace time", () => {
    const slots = [
      slot("late", "building", "2026-11-26T11:40:00Z", "2026-11-26T08:40:00Z"),
      slot("grace", "building", "2026-11-26T11:50:00Z", "2026-11-26T08:50:00Z"),
      slot("done", "posted", "2026-11-26T10:00:00Z", "2026-11-26T07:00:00Z"),
    ];
    expect(missedSlots(slots, now).map((s) => s.id)).toEqual(["late"]);
  });
  it("posts at the slot, now within the grace time, or not at all", () => {
    expect(postTimeFor(new Date("2026-11-26T13:00:00Z"), now)?.toISOString()).toBe(
      "2026-11-26T13:00:00.000Z",
    );
    expect(postTimeFor(new Date("2026-11-26T11:50:00Z"), now)).toEqual(now);
    expect(postTimeFor(new Date("2026-11-26T11:00:00Z"), now)).toBeNull();
  });
  it("is finished once every slot is final", () => {
    expect(routineFinished([{ status: "posted" }, { status: "missed" }])).toBe(true);
    expect(routineFinished([{ status: "posted" }, { status: "scheduled" }])).toBe(false);
  });
});

describe("fakePlan", () => {
  it("follows the mix, rotates voices and avoids past ideas", () => {
    const plan = fakePlan({
      slotIds: ["s1", "s2", "s3", "s4"],
      config: parseConfig({
        voices: ["v1", "v2"],
        genreMix: [
          { genre: "brainteaser", weight: 1 },
          { genre: "explainer", weight: 1 },
        ],
      }),
      libraries: { styles: ["handmade-2d"], voices: ["v1", "v2", "v3"], music: ["m1"] },
      past: [{ title: "Why the sky is blue", idea: "" }],
    });
    expect(plan.map((p) => p.brief.voiceKey)).toEqual(["v1", "v2", "v1", "v2"]);
    expect(plan.filter((p) => p.brief.genre === "brainteaser")).toHaveLength(2);
    expect(plan.some((p) => p.brief.title === "Why the sky is blue")).toBe(false);
  });
});

describe("parseConfig", () => {
  it("drops junk and bounds lists", () => {
    const c = parseConfig({
      references: [
        { url: "https://www.instagram.com/reel/abc", note: "pacing" },
        { url: "not a url" },
      ],
      genreMix: [
        { genre: "Brain Teaser", weight: 2 },
        { genre: "", weight: 1 },
      ],
      rules: "  test three voices ",
      useAvatar: "yes",
    });
    expect(c.references).toEqual([{ url: "https://www.instagram.com/reel/abc", note: "pacing" }]);
    expect(c.genreMix).toEqual([{ genre: "brain-teaser", weight: 2 }]);
    expect(c.rules).toBe("test three voices");
    expect(c.useAvatar).toBe(false);
  });
});

describe("nextForBuild", () => {
  const base = { failedStep: null, waitingStep: null, review: null, retries: 0 } as const;
  it("finishes a ready video that passed (or sent no) review", () => {
    expect(nextForBuild({ ...base, productionStatus: "ready" }).kind).toBe("finish");
    expect(
      nextForBuild({ ...base, productionStatus: "ready", review: { passed: true, notes: [] } })
        .kind,
    ).toBe("finish");
  });
  it("redoes the render once after a failed self-review, then gives up", () => {
    const review = { passed: false, notes: ["Title cut off at 0:03."] };
    expect(nextForBuild({ ...base, productionStatus: "ready", review })).toEqual({
      kind: "retry",
      step: "render",
      note: "Fix what your check found: Title cut off at 0:03.",
    });
    expect(nextForBuild({ ...base, productionStatus: "ready", review, retries: 1 }).kind).toBe(
      "fail",
    );
  });
  it("retries a failed step once", () => {
    const failedStep = { step: "visuals", message: "Remotion crashed" };
    expect(nextForBuild({ ...base, productionStatus: "failed", failedStep }).kind).toBe("retry");
    expect(nextForBuild({ ...base, productionStatus: "failed", failedStep, retries: 1 }).kind).toBe(
      "fail",
    );
  });
  it("says what a waiting video waits for", () => {
    const next = nextForBuild({
      ...base,
      productionStatus: "waiting",
      waitingStep: { step: "face_quote", message: "Autopilot paused: over the cap." },
    });
    expect(next).toEqual({
      kind: "wait",
      message: "Waiting at face_quote: Autopilot paused: over the cap.",
    });
  });
});

describe("parseReview", () => {
  it("reads the session's check", () => {
    expect(parseReview({ passed: false, notes: ["x", 3] })).toEqual({
      passed: false,
      notes: ["x"],
    });
    expect(parseReview({ notes: [] })).toBeNull();
  });
});

describe("local inputs", () => {
  it("round-trips a datetime-local value in the workspace timezone", () => {
    const at = fromLocalInput("2026-11-26T09:30", "Europe/Madrid");
    expect(at?.toISOString()).toBe("2026-11-26T08:30:00.000Z");
    expect(toLocalInput(at ?? new Date(0), "Europe/Madrid")).toBe("2026-11-26T09:30");
    expect(fromLocalInput("nope", "UTC")).toBeNull();
  });
});
