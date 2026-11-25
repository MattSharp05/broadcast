import type { Json } from "@/lib/db/types";
import {
  fakePlan,
  layoutSlots,
  parseConfig,
  type RoutineConfig,
  type SlotStatus,
} from "@/lib/domain/routines";
import { stableUuid } from "@/lib/hash";
import { HOUR_MS, baseSeed } from "./factory";
import type { SandboxSeed, Scenario } from "./types";

/**
 * Routine scenarios (ADR 0009). The fake planner and the fake runner do the planning and the
 * building at once, so a whole routine (plan, build, review, schedule) can be QA'd on production.
 */

const TIMEZONE = "Europe/London";
const MINUTE_MS = 60_000;

export const ROUTINE_CONFIG: RoutineConfig = parseConfig({
  references: [
    {
      url: "https://www.instagram.com/reel/C0aBcDeFgHi/",
      note: "Pacing: a new beat every 2 seconds.",
    },
  ],
  styles: ["handmade-2d", "motion-graphics"],
  genreMix: [
    { genre: "brainteaser", weight: 2 },
    { genre: "explainer", weight: 3 },
  ],
  voices: ["design-m2", "r3-f03"],
  music: ["floating-cities", "wallpaper"],
  rules: "Short and punchy: under 40 seconds. Brainteasers pause 3 seconds before the answer.",
});

const LIBRARIES = {
  styles: ["handmade-2d", "motion-graphics"],
  voices: ["design-m2", "r3-f03"],
  music: ["floating-cities", "wallpaper"],
};

/** The page of a routine scenario's routine. */
export function routinePage(name: string): string {
  return `/routines/${stableUuid(name, "routine", "weekend")}`;
}

function withTemplate(name: string, now: Date) {
  const { seed, id } = baseSeed(name, now);
  seed.timezone = TIMEZONE;
  const templateId = id("template", "teasers");
  seed.factory.routineTemplates.push({
    id: templateId,
    name: "Brainteasers and explainers",
    description: "Two brainteasers for every three explainers, two voices compared.",
    config: ROUTINE_CONFIG as unknown as NonNullable<Json>,
  });
  return { seed, id, templateId };
}

/**
 * A routine on @codingjourney: every 2 hours, all day, for a day and a half from about now. Its
 * first two slots are inside the 4-hour lead time, so they build as soon as it runs.
 */
function routineSeed(
  name: string,
  now: Date,
  opts: { status: "draft" | "planned" | "running"; approval: "auto" | "review"; past?: boolean },
): SandboxSeed {
  const { seed, id, templateId } = withTemplate(name, now);
  const routineId = id("routine", "weekend");
  const accountId = id("account", "cj");
  // Past slots (posted, missed, failed) only when the routine started earlier.
  const startsAt = new Date(
    Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + (opts.past ? -6 * HOUR_MS : HOUR_MS),
  );
  const endsAt = new Date(startsAt.getTime() + 36 * HOUR_MS);
  const input = {
    startsAt,
    endsAt,
    postsPerDay: 12,
    windowStart: "00:00",
    windowEnd: "24:00",
    timezone: TIMEZONE,
    accountIds: [accountId],
    // Four hours: the first two slots are already due when the scenario loads.
    leadMinutes: 240,
  };
  seed.factory.routines.push({
    id: routineId,
    template_id: templateId,
    name: "Weekend on @codingjourney",
    status: opts.status,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    posts_per_day: input.postsPerDay,
    window_start: input.windowStart,
    window_end: input.windowEnd,
    lead_minutes: input.leadMinutes,
    max_parallel: 2,
    approval: opts.approval,
    budget_usd: 10,
    config: ROUTINE_CONFIG as unknown as NonNullable<Json>,
    tags: ["Weekend test"],
    planned_at: opts.status === "draft" ? null : new Date(now.getTime() - HOUR_MS).toISOString(),
    approved_at:
      opts.status === "running" ? new Date(now.getTime() - 7 * HOUR_MS).toISOString() : null,
  });
  seed.factory.routineAccounts.push({ routine_id: routineId, account_id: accountId });

  const slots = layoutSlots(input);
  const slotId = (position: number) => id("slot", String(position));
  const plan = fakePlan({
    slotIds: slots.map((s) => slotId(s.position)),
    config: ROUTINE_CONFIG,
    libraries: LIBRARIES,
    past: [],
  });
  for (const s of slots) {
    const brief = plan.find((p) => p.slotId === slotId(s.position))?.brief ?? null;
    let status: SlotStatus = opts.status === "draft" ? "open" : "planned";
    let message: string | null = null;
    // Past slots of a running routine, for the page to show every state.
    if (opts.past && s.postAt < now) {
      const age = (now.getTime() - s.postAt.getTime()) / MINUTE_MS;
      if (age > 4 * 60) status = "posted";
      else if (age > 2 * 60) {
        status = "missed";
        message = "Not ready in time. The video stays in the Content Factory.";
      } else {
        status = "failed";
        message = "The video failed at render: Remotion crashed twice.";
      }
    }
    seed.factory.routineSlots.push({
      id: slotId(s.position),
      routine_id: routineId,
      account_id: s.accountId,
      position: s.position,
      post_at: s.postAt.toISOString(),
      build_at: s.buildAt.toISOString(),
      brief:
        status === "open" || !brief
          ? null
          : {
              title: brief.title,
              idea: brief.idea,
              genre: brief.genre,
              hook: brief.hook,
              style: brief.style,
              voice_key: brief.voiceKey,
              music_key: brief.musicKey,
              notes: brief.notes,
            },
      status,
      message,
    });
  }
  return seed;
}

export const routineTemplate: Scenario = {
  name: "routine-template",
  description:
    "Two accounts and a saved routine template (brainteasers and explainers, two voices).",
  page: "/routines",
  build: ({ now }) => withTemplate("routine-template", now).seed,
};

export const routineDraft: Scenario = {
  name: "routine-draft",
  description: "A saved routine on @codingjourney, every 2 hours for 36 hours, not planned yet.",
  page: routinePage("routine-draft"),
  build: ({ now }) => routineSeed("routine-draft", now, { status: "draft", approval: "review" }),
};

export const routinePlanned: Scenario = {
  name: "routine-planned",
  description: "A routine whose plan is ready to approve; finished videos wait for approval.",
  page: routinePage("routine-planned"),
  build: ({ now }) =>
    routineSeed("routine-planned", now, { status: "planned", approval: "review" }),
};

export const routineRunning: Scenario = {
  name: "routine-running",
  description:
    "A running routine that posts automatically: past slots posted, missed and failed, the next ones due.",
  page: routinePage("routine-running"),
  build: ({ now }) =>
    routineSeed("routine-running", now, { status: "running", approval: "auto", past: true }),
};

export const ROUTINE_SCENARIOS: readonly Scenario[] = [
  routineTemplate,
  routineDraft,
  routinePlanned,
  routineRunning,
];
