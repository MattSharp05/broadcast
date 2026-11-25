import "server-only";
import { configuredAppOrigin } from "@/lib/app-url";
import { FactoryError, fail, type Db } from "@/lib/db/factory";
import { workspaceKindOf } from "@/lib/db/workspaces";
import { STYLE_PACKS } from "@/lib/domain/factory/styles";
import {
  cadenceLabel,
  fakePlan,
  mixCounts,
  parseBrief,
  parseConfig,
  planIssues,
  type PastIdea,
  type PlanIssue,
  type PlanLibraries,
  type SlotBrief,
} from "@/lib/domain/routines";
import { firePlanner } from "@/lib/factory/runner";
import { mintRoutineToken } from "@/lib/factory/tokens";
import {
  briefJson,
  getRoutine,
  getSlots,
  updateRoutine,
  updateSlot,
  type RoutineCtx,
} from "./store";

/**
 * The planner (ADR 0009): one session per routine writes a brief for every slot. In the Sandbox
 * the fake planner (src/lib/domain/routines.ts → fakePlan) answers at once, with no session.
 */

/** The styles, voices and tracks a plan may use. Cloned voices are opt-in only, never planned. */
export async function planLibraries(db: Db): Promise<PlanLibraries> {
  const [voices, music] = await Promise.all([
    db.from("factory_voices").select("key").neq("kind", "clone").order("sort"),
    db.from("factory_music").select("key").order("sort"),
  ]);
  if (voices.error) fail("reading the voices", voices.error);
  if (music.error) fail("reading the music", music.error);
  return {
    styles: STYLE_PACKS.map((s) => s.key),
    voices: voices.data.map((v) => v.key),
    music: music.data.map((m) => m.key),
  };
}

export interface PastVideo extends PastIdea {
  hook: string;
  genre: string | null;
  style: string | null;
  voice: string | null;
  music: string | null;
  account: string | null;
  views_24h: number | null;
  source: "video" | "planned";
}

/**
 * Every idea already used: the workspace's videos, plus briefs other routines planned but
 * haven't built yet (so routine 1 and routine 2 never plan the same video). Newest first.
 */
export async function pastIdeas(
  db: Db,
  ws: string,
  exceptRoutineId: string | null,
): Promise<PastVideo[]> {
  const [videos, planned, accounts] = await Promise.all([
    db
      .from("productions")
      .select("id, title, idea, script, genre, style, voice_key, music_key, account_id, post_id")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("routine_slots")
      .select("routine_id, brief, account_id")
      .eq("workspace_id", ws)
      .is("production_id", null)
      .not("brief", "is", null)
      .not("status", "in", "(skipped,missed)"),
    db.from("social_accounts").select("id, handle").eq("workspace_id", ws),
  ]);
  if (videos.error) fail("reading past videos", videos.error);
  if (planned.error) fail("reading planned videos", planned.error);
  if (accounts.error) fail("reading the accounts", accounts.error);
  const handle = new Map(accounts.data.map((a) => [a.id, `@${a.handle}`]));
  const postIds = videos.data.map((v) => v.post_id).filter((p): p is string => Boolean(p));
  const views = new Map<string, number>();
  if (postIds.length) {
    const m = await db
      .from("post_metrics")
      .select("post_id, views")
      .eq("workspace_id", ws)
      .eq("stat_offset", "24h")
      .in("post_id", postIds);
    if (m.error) fail("reading the stats", m.error);
    for (const r of m.data) if (r.views !== null) views.set(r.post_id, r.views);
  }
  const out: PastVideo[] = videos.data
    .filter((v) => v.title.trim() || v.idea.trim())
    .map((v) => ({
      title: v.title,
      idea: v.idea,
      hook: ((v.script as { hook?: unknown } | null)?.hook as string | undefined) ?? "",
      genre: v.genre,
      style: v.style,
      voice: v.voice_key,
      music: v.music_key,
      account: v.account_id ? (handle.get(v.account_id) ?? null) : null,
      views_24h: v.post_id ? (views.get(v.post_id) ?? null) : null,
      source: "video",
    }));
  for (const s of planned.data) {
    if (s.routine_id === exceptRoutineId) continue;
    const b = parseBrief(s.brief);
    if (!b) continue;
    out.push({
      title: b.title,
      idea: b.idea,
      hook: b.hook,
      genre: b.genre,
      style: b.style,
      voice: b.voiceKey,
      music: b.musicKey,
      account: handle.get(s.account_id) ?? null,
      views_24h: null,
      source: "planned",
    });
  }
  return out;
}

/** GET /api/routines/{id}/brief: everything the planner session needs. */
export async function plannerBrief(ctx: RoutineCtx, id: string) {
  const ws = ctx.workspaceId;
  const r = await getRoutine(ctx.db, ws, id);
  const config = parseConfig(r.config);
  const [slots, libraries, past, accounts, voices, music] = await Promise.all([
    getSlots(ctx.db, ws, id),
    planLibraries(ctx.db),
    pastIdeas(ctx.db, ws, id),
    ctx.db.from("social_accounts").select("id, handle, description, tags").eq("workspace_id", ws),
    ctx.db
      .from("factory_voices")
      .select("key, label, description")
      .neq("kind", "clone")
      .order("sort"),
    ctx.db.from("factory_music").select("key, title, artist, mood, bpm").order("sort"),
  ]);
  if (accounts.error) fail("reading the accounts", accounts.error);
  const byId = new Map(accounts.data.map((a) => [a.id, a]));
  const pick = <T extends { key: string }>(rows: T[] | null, allowed: string[]) =>
    (rows ?? []).filter((x) => !allowed.length || allowed.includes(x.key));
  return {
    routine: {
      id: r.id,
      name: r.name,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      timezone: ctx.timezone,
      posts_per_day: r.posts_per_day,
      cadence: cadenceLabel(r.posts_per_day, r.window_start, r.window_end),
      approval: r.approval,
      tags: r.tags,
      references: config.references,
      rules: config.rules,
      use_avatar: config.useAvatar,
      genre_mix: config.genreMix,
      genre_targets: Object.fromEntries(mixCounts(config.genreMix, slots.length)),
    },
    accounts: [...new Set(slots.map((s) => s.accountId))].map((aid) => {
      const a = byId.get(aid);
      return {
        id: aid,
        handle: a ? `@${a.handle}` : null,
        description: a?.description ?? "",
        tags: a?.tags ?? [],
      };
    }),
    slots: slots.map((s) => ({
      id: s.id,
      position: s.position,
      account: byId.has(s.accountId) ? `@${byId.get(s.accountId)?.handle ?? ""}` : null,
      post_at: s.postAt.toISOString(),
    })),
    allowed: {
      styles: STYLE_PACKS.filter((s) => !config.styles.length || config.styles.includes(s.key)).map(
        (s) => ({
          key: s.key,
          label: s.label,
          suits: s.suits,
        }),
      ),
      voices: pick(voices.data, config.voices).filter((v) => libraries.voices.includes(v.key)),
      music: pick(music.data, config.music),
    },
    // Never repeat one of these (checked again when the plan is posted).
    past_videos: past.slice(0, 300),
  };
}

export type PlanStart =
  | { kind: "fake" }
  | { kind: "session"; sessionUrl: string }
  | { kind: "manual"; prompt: string; reason: string }
  | { kind: "error"; message: string };

/** Plan videos: fires the planner session (or, in the Sandbox, plans at once). */
export async function startPlanning(
  ctx: RoutineCtx & { appUrl?: string },
  id: string,
): Promise<PlanStart> {
  const ws = ctx.workspaceId;
  const r = await getRoutine(ctx.db, ws, id);
  if (!["draft", "planned", "planning"].includes(r.status))
    throw new FactoryError("started", "This routine has started; its plan can't change now.");
  const slots = await getSlots(ctx.db, ws, id);
  if (!slots.length) throw new FactoryError("empty", "The routine has no slots. Check its dates.");
  await updateRoutine(ctx.db, ws, id, {
    status: "planning",
    plan_message: "A planner session is writing the briefs.",
    plan_session_url: null,
  });

  if (workspaceKindOf(ws) === "sandbox") {
    const config = parseConfig(r.config);
    const plan = fakePlan({
      slotIds: slots.map((s) => s.id),
      config,
      libraries: await planLibraries(ctx.db),
      past: await pastIdeas(ctx.db, ws, id),
    });
    await savePlan(ctx, id, plan, { validate: false });
    return { kind: "fake" };
  }

  const token = await mintRoutineToken(ctx, id);
  const appUrl = ctx.appUrl ?? configuredAppOrigin() ?? "http://localhost:3000";
  const result = await firePlanner({ routineId: id, appUrl, token });
  if (result.kind === "session") {
    await updateRoutine(ctx.db, ws, id, { plan_session_url: result.sessionUrl });
    return { kind: "session", sessionUrl: result.sessionUrl };
  }
  if (result.kind === "manual") {
    await updateRoutine(ctx.db, ws, id, {
      plan_message:
        "Waiting for a planner session. Paste the prompt into a new session on video-editor.",
    });
    return result;
  }
  await updateRoutine(ctx.db, ws, id, { status: "draft", plan_message: result.message });
  return result;
}

/**
 * Saves one brief per slot (from the planner session, or the Sandbox's fake planner). A session's
 * plan is checked first: every slot covered, only allowed styles/voices/tracks, no repeated idea.
 */
export async function savePlan(
  ctx: RoutineCtx,
  id: string,
  plan: readonly { slotId: string; brief: SlotBrief | null }[],
  opts: { validate?: boolean } = {},
): Promise<PlanIssue[]> {
  const ws = ctx.workspaceId;
  const r = await getRoutine(ctx.db, ws, id);
  if (r.status !== "planning" && r.status !== "planned" && r.status !== "draft")
    throw new FactoryError("started", "This routine has started; its plan can't change now.");
  const slots = await getSlots(ctx.db, ws, id);
  if (opts.validate ?? true) {
    const issues = planIssues({
      slotIds: slots.map((s) => s.id),
      briefs: plan,
      config: parseConfig(r.config),
      libraries: await planLibraries(ctx.db),
      past: await pastIdeas(ctx.db, ws, id),
    });
    if (issues.length) return issues;
  }
  for (const { slotId, brief } of plan) {
    if (!brief) continue;
    await updateSlot(ctx.db, ws, slotId, {
      brief: briefJson(brief),
      status: "planned",
      message: null,
    });
  }
  await updateRoutine(ctx.db, ws, id, {
    status: "planned",
    planned_at: ctx.now.toISOString(),
    plan_message: null,
  });
  return [];
}

/** The planner session gave up: the routine goes back to draft with its reason. */
export async function failPlanning(ctx: RoutineCtx, id: string, message: string): Promise<void> {
  await updateRoutine(ctx.db, ctx.workspaceId, id, {
    status: "draft",
    plan_message: `Planning failed: ${message.slice(0, 500)}`,
  });
}

/** Approve the plan: the routine runs, and builds start as their slots come due. */
export async function approvePlan(ctx: RoutineCtx, id: string): Promise<void> {
  const ws = ctx.workspaceId;
  const r = await getRoutine(ctx.db, ws, id);
  if (r.status !== "planned") throw new FactoryError("not_planned", "Plan the videos first.");
  const slots = await getSlots(ctx.db, ws, id);
  if (slots.some((s) => s.status === "open"))
    throw new FactoryError("not_planned", "Some slots have no brief. Plan the videos again.");
  await updateRoutine(ctx.db, ws, id, { status: "running", approved_at: ctx.now.toISOString() });
}
