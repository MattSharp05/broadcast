import "server-only";
import { FactoryError, fail, type Db } from "@/lib/db/factory";
import type { Database, Json } from "@/lib/db/types";
import {
  layoutSlots,
  parseBrief,
  parseConfig,
  scheduleIssues,
  type Approval,
  type RoutineConfig,
  type RoutineStatus,
  type SlotBrief,
  type SlotStatus,
} from "@/lib/domain/routines";
import { cleanTags } from "@/lib/domain/tags";

/**
 * Routines and templates (ADR 0009): reads and writes, every query scoped by workspace_id.
 * Service-role client from the tick and the planner API; the user's client from the pages.
 */

export type RoutineRow = Database["public"]["Tables"]["routines"]["Row"];
export type SlotRow = Database["public"]["Tables"]["routine_slots"]["Row"];
export type TemplateRow = Database["public"]["Tables"]["routine_templates"]["Row"];

export interface RoutineCtx {
  db: Db;
  workspaceId: string;
  now: Date;
  timezone: string;
}

export interface RoutineInput {
  name: string;
  templateId: string | null;
  startsAt: Date;
  endsAt: Date;
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  leadMinutes: number;
  maxParallel: number;
  approval: Approval;
  budgetUsd: number | null;
  tags: string[];
  accountIds: string[];
  config: RoutineConfig;
}

export interface Slot {
  id: string;
  accountId: string;
  position: number;
  postAt: Date;
  buildAt: Date;
  status: SlotStatus;
  brief: SlotBrief | null;
  productionId: string | null;
  postId: string | null;
  message: string | null;
  retries: number;
}

export function toSlot(r: SlotRow): Slot {
  return {
    id: r.id,
    accountId: r.account_id,
    position: r.position,
    postAt: new Date(r.post_at),
    buildAt: new Date(r.build_at),
    status: r.status as SlotStatus,
    brief: r.brief ? parseBrief(r.brief) : null,
    productionId: r.production_id,
    postId: r.post_id,
    message: r.message,
    retries: r.retries,
  };
}

/** A brief as stored (the planner API's snake_case). */
export function briefJson(b: SlotBrief): NonNullable<Json> {
  return {
    title: b.title,
    idea: b.idea,
    genre: b.genre,
    hook: b.hook,
    style: b.style,
    voice_key: b.voiceKey,
    music_key: b.musicKey,
    notes: b.notes,
  };
}

export async function getRoutine(db: Db, ws: string, id: string): Promise<RoutineRow> {
  const { data, error } = await db
    .from("routines")
    .select("*")
    .eq("workspace_id", ws)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("reading the routine", error);
  if (!data) throw new FactoryError("not_found", "That routine doesn't exist (any more).");
  return data;
}

export async function getSlots(db: Db, ws: string, routineId: string): Promise<Slot[]> {
  const { data, error } = await db
    .from("routine_slots")
    .select("*")
    .eq("workspace_id", ws)
    .eq("routine_id", routineId)
    .order("position");
  if (error) fail("reading the routine's slots", error);
  return data.map(toSlot);
}

export async function getRoutineAccounts(db: Db, ws: string, routineId: string): Promise<string[]> {
  const { data, error } = await db
    .from("routine_accounts")
    .select("account_id")
    .eq("workspace_id", ws)
    .eq("routine_id", routineId);
  if (error) fail("reading the routine's accounts", error);
  return data.map((r) => r.account_id);
}

export async function updateSlot(
  db: Db,
  ws: string,
  id: string,
  patch: Database["public"]["Tables"]["routine_slots"]["Update"],
): Promise<void> {
  const { error } = await db
    .from("routine_slots")
    .update(patch)
    .eq("workspace_id", ws)
    .eq("id", id);
  if (error) fail("saving the slot", error);
}

export async function updateRoutine(
  db: Db,
  ws: string,
  id: string,
  patch: Database["public"]["Tables"]["routines"]["Update"],
): Promise<void> {
  const { error } = await db.from("routines").update(patch).eq("workspace_id", ws).eq("id", id);
  if (error) fail("saving the routine", error);
}

/** Checks a routine's form; the first problem as a FactoryError. */
function validate(input: RoutineInput, timezone: string) {
  if (!input.name.trim()) throw new FactoryError("invalid", "Give the routine a name.");
  const issues = scheduleIssues({ ...input, timezone });
  if (issues[0]) throw new FactoryError("invalid", issues[0].message);
  if (input.leadMinutes < 30 || input.leadMinutes > 2880)
    throw new FactoryError(
      "invalid",
      "Start building between 30 minutes and 2 days before each post.",
    );
  if (input.maxParallel < 1 || input.maxParallel > 10)
    throw new FactoryError("invalid", "Build between 1 and 10 videos at once.");
  if (input.budgetUsd !== null && (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0))
    throw new FactoryError("invalid", "The budget must be a positive amount, or empty.");
  if (input.config.useAvatar && !input.config.avatarId)
    throw new FactoryError("invalid", "Pick the avatar, or switch the avatar off.");
}

/**
 * Creates a routine, or edits one that hasn't started (draft or plan ready). Saving lays the
 * posting schedule out again; an edited plan's briefs are cleared, so it needs planning again.
 */
export async function saveRoutine(
  ctx: RoutineCtx,
  id: string | null,
  input: RoutineInput,
): Promise<string> {
  validate(input, ctx.timezone);
  const ws = ctx.workspaceId;
  const accounts = await ctx.db
    .from("social_accounts")
    .select("id")
    .eq("workspace_id", ws)
    .in("id", input.accountIds);
  if (accounts.error) fail("reading the accounts", accounts.error);
  if (accounts.data.length !== new Set(input.accountIds).size)
    throw new FactoryError("invalid", "One of the accounts doesn't exist in this workspace.");

  const row = {
    workspace_id: ws,
    name: input.name.trim().slice(0, 80),
    template_id: input.templateId,
    starts_at: input.startsAt.toISOString(),
    ends_at: input.endsAt.toISOString(),
    posts_per_day: input.postsPerDay,
    window_start: input.windowStart,
    window_end: input.windowEnd,
    lead_minutes: input.leadMinutes,
    max_parallel: input.maxParallel,
    approval: input.approval,
    budget_usd: input.budgetUsd,
    tags: cleanTags(input.tags),
    config: input.config as unknown as NonNullable<Json>,
    status: "draft",
    planned_at: null,
    plan_message: null,
    plan_session_url: null,
  } satisfies Database["public"]["Tables"]["routines"]["Insert"];

  let routineId = id;
  if (routineId) {
    const current = await getRoutine(ctx.db, ws, routineId);
    if (!["draft", "planned"].includes(current.status))
      throw new FactoryError(
        "started",
        "This routine has started. Pause or cancel it, or make a new one from its template.",
      );
    await updateRoutine(ctx.db, ws, routineId, row);
    const del = await ctx.db
      .from("routine_accounts")
      .delete()
      .eq("workspace_id", ws)
      .eq("routine_id", routineId);
    if (del.error) fail("saving the accounts", del.error);
    const slots = await ctx.db
      .from("routine_slots")
      .delete()
      .eq("workspace_id", ws)
      .eq("routine_id", routineId);
    if (slots.error) fail("clearing the slots", slots.error);
  } else {
    const { data, error } = await ctx.db.from("routines").insert(row).select("id").single();
    if (error) fail("creating the routine", error);
    routineId = data.id;
  }

  const links = [...new Set(input.accountIds)].map((account_id) => ({
    workspace_id: ws,
    routine_id: routineId,
    account_id,
  }));
  const linked = await ctx.db.from("routine_accounts").insert(links);
  if (linked.error) fail("saving the accounts", linked.error);

  const laid = layoutSlots({ ...input, timezone: ctx.timezone });
  const inserted = await ctx.db.from("routine_slots").insert(
    laid.map((s) => ({
      workspace_id: ws,
      routine_id: routineId,
      account_id: s.accountId,
      position: s.position,
      post_at: s.postAt.toISOString(),
      build_at: s.buildAt.toISOString(),
    })),
  );
  if (inserted.error) fail("laying out the schedule", inserted.error);
  return routineId;
}

export async function deleteRoutine(ctx: RoutineCtx, id: string): Promise<void> {
  const r = await getRoutine(ctx.db, ctx.workspaceId, id);
  if (r.status === "running" || r.status === "planning")
    throw new FactoryError("running", "Pause or cancel the routine before deleting it.");
  // Its videos stay in the Content Factory (routine_id is cleared).
  const { error } = await ctx.db
    .from("routines")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", id);
  if (error) fail("deleting the routine", error);
}

export async function setStatus(ctx: RoutineCtx, id: string, status: RoutineStatus): Promise<void> {
  await updateRoutine(ctx.db, ctx.workspaceId, id, { status });
}

// ───────────────────────────── templates ─────────────────────────────

export async function saveTemplate(
  ctx: RoutineCtx,
  id: string | null,
  input: { name: string; description: string; config: RoutineConfig },
): Promise<string> {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new FactoryError("invalid", "Give the template a name.");
  const row = {
    workspace_id: ctx.workspaceId,
    name,
    description: input.description.trim().slice(0, 500),
    config: parseConfig(input.config) as unknown as NonNullable<Json>,
  };
  const res = id
    ? await ctx.db
        .from("routine_templates")
        .update(row)
        .eq("workspace_id", ctx.workspaceId)
        .eq("id", id)
        .select("id")
        .single()
    : await ctx.db.from("routine_templates").insert(row).select("id").single();
  if (res.error) {
    if (res.error.code === "23505")
      throw new FactoryError("duplicate", `A template called "${name}" already exists.`);
    fail("saving the template", res.error);
  }
  return res.data.id;
}

export async function deleteTemplate(ctx: RoutineCtx, id: string): Promise<void> {
  const { error } = await ctx.db
    .from("routine_templates")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", id);
  if (error) fail("deleting the template", error);
}

export async function listTemplates(db: Db, ws: string): Promise<TemplateRow[]> {
  const { data, error } = await db
    .from("routine_templates")
    .select("*")
    .eq("workspace_id", ws)
    .order("name");
  if (error) fail("reading the templates", error);
  return data;
}
