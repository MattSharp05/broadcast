"use server";

import { revalidatePath } from "next/cache";
import { nowFor } from "@/lib/clock";
import { createAdminSupabase } from "@/lib/db/admin";
import { isSignedInOwner } from "@/lib/db/auth";
import { FactoryError } from "@/lib/db/factory";
import { currentWorkspace } from "@/lib/db/workspace";
import { fromLocalInput, parseConfig, type Approval } from "@/lib/domain/routines";
import {
  advanceRoutine,
  approveSlot,
  cancelRoutine,
  skipSlot,
  type BuilderCtx,
} from "@/lib/routines/builder";
import { approvePlan, startPlanning, type PlanStart } from "@/lib/routines/planner";
import {
  deleteRoutine,
  deleteTemplate,
  getRoutine,
  saveRoutine,
  saveTemplate,
  setStatus,
  updateRoutine,
} from "@/lib/routines/store";

/**
 * Routines (ADR 0009): server actions behind the Routines tab. Service role, after checking the
 * signed-in owner; every query is scoped by the workspace.
 */

export type RoutineResult<T = null> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function context(): Promise<BuilderCtx> {
  if (!(await isSignedInOwner())) throw new FactoryError("signed_out", "Sign in again.");
  const workspace = await currentWorkspace();
  return {
    db: createAdminSupabase(),
    workspaceId: workspace.id,
    now: nowFor(workspace),
    timezone: workspace.timezone ?? "UTC",
  };
}

async function guard<T>(fn: () => Promise<T>): Promise<RoutineResult<T>> {
  try {
    const value = await fn();
    revalidatePath("/routines", "layout");
    return { ok: true, value };
  } catch (err) {
    if (err instanceof FactoryError) return { ok: false, error: err.message };
    console.error("Routines action failed:", err);
    return { ok: false, error: "That didn't work. Check your connection and try again." };
  }
}

function id(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new FactoryError("not_found", "Unknown routine.");
  return value;
}

export interface RoutineForm {
  name: string;
  templateId: string | null;
  startsAt: string;
  endsAt: string;
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  leadMinutes: number;
  maxParallel: number;
  approval: Approval;
  budgetUsd: string;
  tags: string[];
  accountIds: string[];
  config: unknown;
}

const text = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => Math.round(Number(v));

export async function saveRoutineAction(routineId: string | null, input: RoutineForm) {
  return guard(async () => {
    const ctx = await context();
    // Untrusted: a server action can be called with anything.
    const form = input as unknown as Record<string, unknown>;
    const startsAt = fromLocalInput(text(form.startsAt), ctx.timezone);
    const endsAt = fromLocalInput(text(form.endsAt), ctx.timezone);
    if (!startsAt || !endsAt)
      throw new FactoryError("invalid", "Pick when the routine starts and ends.");
    const budget = text(form.budgetUsd).trim();
    const templateId = text(form.templateId);
    const list = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    return saveRoutine(ctx, routineId ? id(routineId) : null, {
      name: text(form.name),
      templateId: UUID.test(templateId) ? templateId : null,
      startsAt,
      endsAt,
      postsPerDay: num(form.postsPerDay),
      windowStart: text(form.windowStart),
      windowEnd: text(form.windowEnd),
      leadMinutes: num(form.leadMinutes),
      maxParallel: num(form.maxParallel),
      approval: form.approval === "auto" ? "auto" : "review",
      budgetUsd: budget === "" ? null : Number(budget),
      tags: list(form.tags),
      accountIds: list(form.accountIds).filter((a) => UUID.test(a)),
      config: parseConfig(form.config),
    });
  });
}

export async function saveTemplateAction(
  templateId: string | null,
  input: { name: string; description: string; config: unknown },
) {
  return guard(async () => {
    const ctx = await context();
    const form = input as unknown as Record<string, unknown>;
    return saveTemplate(ctx, templateId ? id(templateId) : null, {
      name: text(form.name),
      description: text(form.description),
      config: parseConfig(form.config),
    });
  });
}

export async function deleteTemplateAction(templateId: string) {
  return guard(async () => deleteTemplate(await context(), id(templateId)));
}

export async function deleteRoutineAction(routineId: string) {
  return guard(async () => deleteRoutine(await context(), id(routineId)));
}

export async function planRoutineAction(routineId: string) {
  return guard(async (): Promise<PlanStart> => startPlanning(await context(), id(routineId)));
}

export async function approvePlanAction(routineId: string) {
  return guard(async () => {
    const ctx = await context();
    await approvePlan(ctx, id(routineId));
    // Build whatever is due straight away instead of waiting for the next tick.
    await advanceRoutine(ctx, routineId);
    return null;
  });
}

export async function pauseRoutineAction(routineId: string) {
  return guard(async () => {
    const ctx = await context();
    const r = await getRoutine(ctx.db, ctx.workspaceId, id(routineId));
    if (r.status !== "running")
      throw new FactoryError("not_running", "Only a running routine can pause.");
    await setStatus(ctx, r.id, "paused");
    return null;
  });
}

export async function resumeRoutineAction(routineId: string) {
  return guard(async () => {
    const ctx = await context();
    const r = await getRoutine(ctx.db, ctx.workspaceId, id(routineId));
    if (r.status !== "paused") throw new FactoryError("not_paused", "This routine isn't paused.");
    await updateRoutine(ctx.db, ctx.workspaceId, r.id, { status: "running", plan_message: null });
    await advanceRoutine(ctx, r.id);
    return null;
  });
}

export async function cancelRoutineAction(routineId: string) {
  return guard(async () => cancelRoutine(await context(), id(routineId)));
}

/** Does now what the next scheduler tick would do for this routine. */
export async function runRoutineNowAction(routineId: string) {
  return guard(async () => {
    const counts = await advanceRoutine(await context(), id(routineId));
    const parts = Object.entries(counts).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`);
    return parts.length ? `Done: ${parts.join(", ")}.` : "Nothing to do yet.";
  });
}

export async function approveSlotAction(slotId: string) {
  return guard(async () => approveSlot(await context(), id(slotId)));
}

export async function skipSlotAction(slotId: string) {
  return guard(async () => skipSlot(await context(), id(slotId)));
}
