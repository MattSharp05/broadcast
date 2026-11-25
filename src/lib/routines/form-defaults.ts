import { EMPTY_CONFIG, toLocalInput } from "@/lib/domain/routines";
import { addDays, toLocalDate, zonedTimeToUtc } from "@/lib/domain/time";
import type { RoutineFormInitial } from "@/features/routines/RoutineForm";
import type { FormOptions } from "./page";

/** A new routine: tomorrow 00:00 to the day after, 10 a day from 09:00 to 21:00, waiting for you. */
export function newRoutineDefaults(
  now: Date,
  timezone: string,
  options: FormOptions,
  templateId: string | null,
): RoutineFormInitial {
  const tomorrow = addDays(toLocalDate(now, timezone), 1);
  const start = zonedTimeToUtc(tomorrow, 0, timezone);
  const end = zonedTimeToUtc(addDays(tomorrow, 2), 0, timezone);
  const template = options.templates.find((t) => t.id === templateId) ?? null;
  return {
    id: null,
    name: template ? template.name : "",
    templateId: template?.id ?? null,
    startsAt: toLocalInput(start, timezone),
    endsAt: toLocalInput(end, timezone),
    postsPerDay: 10,
    windowStart: "09:00",
    windowEnd: "21:00",
    leadMinutes: 180,
    maxParallel: 3,
    approval: "review",
    budgetUsd: "",
    tags: [],
    accountIds:
      options.accounts.length === 1 && options.accounts[0] ? [options.accounts[0].id] : [],
    config: template?.config ?? { ...EMPTY_CONFIG },
  };
}
