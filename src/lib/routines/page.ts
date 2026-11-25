import "server-only";
import { fail, type Db } from "@/lib/db/factory";
import { spendOf } from "@/lib/domain/factory/budget";
import { STYLE_PACKS } from "@/lib/domain/factory/styles";
import {
  parseConfig,
  slotCounts,
  type RoutineConfig,
  type RoutineStatus,
  type SlotStatus,
} from "@/lib/domain/routines";
import { getRoutineAccounts, getSlots, listTemplates } from "./store";

/** What the Routines pages show (the user's client; RLS lets the owner read everything). */

export interface Option {
  key: string;
  label: string;
  help?: string;
}

export interface FormOptions {
  accounts: { id: string; handle: string; brand: string }[];
  styles: Option[];
  voices: Option[];
  music: Option[];
  avatars: Option[];
  templates: { id: string; name: string; description: string; config: RoutineConfig }[];
}

export async function loadFormOptions(db: Db, ws: string): Promise<FormOptions> {
  const [accounts, voices, music, avatars, templates] = await Promise.all([
    db
      .from("social_accounts")
      .select("id, handle, brands(name)")
      .eq("workspace_id", ws)
      .order("handle"),
    db.from("factory_voices").select("key, label, description").neq("kind", "clone").order("sort"),
    db.from("factory_music").select("key, title, artist, mood").order("sort"),
    db.from("avatars").select("id, name, current_version").eq("workspace_id", ws).order("name"),
    listTemplates(db, ws),
  ]);
  if (accounts.error) fail("reading the accounts", accounts.error);
  if (voices.error) fail("reading the voices", voices.error);
  if (music.error) fail("reading the music", music.error);
  if (avatars.error) fail("reading the avatars", avatars.error);
  return {
    accounts: accounts.data.map((a) => ({
      id: a.id,
      handle: a.handle,
      brand: (a.brands as { name: string } | null)?.name ?? "",
    })),
    styles: STYLE_PACKS.map((s) => ({ key: s.key, label: s.label, help: s.suits })),
    voices: voices.data.map((v) => ({ key: v.key, label: v.label })),
    music: music.data.map((m) => ({ key: m.key, label: `${m.title}, ${m.artist}`, help: m.mood })),
    avatars: avatars.data
      .filter((a) => a.current_version > 0)
      .map((a) => ({ key: a.id, label: a.name })),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      config: parseConfig(t.config),
    })),
  };
}

export interface RoutineListItem {
  id: string;
  name: string;
  status: RoutineStatus;
  startsAt: string;
  endsAt: string;
  postsPerDay: number;
  approval: "auto" | "review";
  accounts: string[];
  counts: Record<SlotStatus, number>;
  total: number;
  nextPostAt: string | null;
}

export async function loadRoutineList(db: Db, ws: string): Promise<RoutineListItem[]> {
  const [routines, links, slots, accounts] = await Promise.all([
    db.from("routines").select("*").eq("workspace_id", ws).order("starts_at", { ascending: false }),
    db.from("routine_accounts").select("routine_id, account_id").eq("workspace_id", ws),
    db.from("routine_slots").select("routine_id, status, post_at").eq("workspace_id", ws),
    db.from("social_accounts").select("id, handle").eq("workspace_id", ws),
  ]);
  for (const r of [routines, links, slots, accounts])
    if (r.error) fail("reading the routines", r.error);
  const handle = new Map((accounts.data ?? []).map((a) => [a.id, `@${a.handle}`]));
  return (routines.data ?? []).map((r) => {
    const mine = (slots.data ?? []).filter((s) => s.routine_id === r.id);
    const upcoming = mine
      .filter(
        (s) =>
          s.status === "scheduled" ||
          s.status === "planned" ||
          s.status === "building" ||
          s.status === "review",
      )
      .map((s) => s.post_at)
      .sort();
    return {
      id: r.id,
      name: r.name,
      status: r.status as RoutineStatus,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      postsPerDay: r.posts_per_day,
      approval: r.approval as "auto" | "review",
      accounts: (links.data ?? [])
        .filter((l) => l.routine_id === r.id)
        .map((l) => handle.get(l.account_id) ?? "?"),
      counts: slotCounts(mine.map((s) => ({ status: s.status as SlotStatus }))),
      total: mine.length,
      nextPostAt: upcoming[0] ?? null,
    };
  });
}

export interface SlotView {
  id: string;
  position: number;
  account: string;
  postAt: string;
  status: SlotStatus;
  message: string | null;
  title: string;
  idea: string;
  genre: string | null;
  hook: string;
  style: string;
  voice: string;
  music: string;
  notes: string;
  productionId: string | null;
  productionStatus: string | null;
  postId: string | null;
}

export async function loadRoutineDetail(db: Db, ws: string, routineId: string) {
  const { data: r, error } = await db
    .from("routines")
    .select("*")
    .eq("workspace_id", ws)
    .eq("id", routineId)
    .maybeSingle();
  if (error) fail("reading the routine", error);
  if (!r) return null;
  const [slots, accountIds, options, prods] = await Promise.all([
    getSlots(db, ws, routineId),
    getRoutineAccounts(db, ws, routineId),
    loadFormOptions(db, ws),
    db.from("productions").select("id, status").eq("workspace_id", ws).eq("routine_id", routineId),
  ]);
  if (prods.error) fail("reading the routine's videos", prods.error);
  let spent = 0;
  const prodIds = prods.data.map((p) => p.id);
  if (prodIds.length) {
    const jobs = await db
      .from("gen_jobs")
      .select("status, cost_usd, quote_usd")
      .eq("workspace_id", ws)
      .in("production_id", prodIds);
    if (jobs.error) fail("reading the spend", jobs.error);
    spent = spendOf(jobs.data);
  }
  const status = new Map(prods.data.map((p) => [p.id, p.status]));
  const handle = new Map(options.accounts.map((a) => [a.id, `@${a.handle}`]));
  const label = (list: { key: string; label: string }[], key: string) =>
    list.find((o) => o.key === key)?.label ?? key;
  const slotViews: SlotView[] = slots.map((s) => ({
    id: s.id,
    position: s.position,
    account: handle.get(s.accountId) ?? "?",
    postAt: s.postAt.toISOString(),
    status: s.status,
    message: s.message,
    title: s.brief?.title ?? "",
    idea: s.brief?.idea ?? "",
    genre: s.brief?.genre ?? null,
    hook: s.brief?.hook ?? "",
    style: s.brief ? label(options.styles, s.brief.style) : "",
    voice: s.brief ? label(options.voices, s.brief.voiceKey) : "",
    music: s.brief ? label(options.music, s.brief.musicKey) : "",
    notes: s.brief?.notes ?? "",
    productionId: s.productionId,
    productionStatus: s.productionId ? (status.get(s.productionId) ?? null) : null,
    postId: s.postId,
  }));
  return {
    routine: {
      id: r.id,
      name: r.name,
      status: r.status as RoutineStatus,
      templateId: r.template_id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      postsPerDay: r.posts_per_day,
      windowStart: r.window_start,
      windowEnd: r.window_end,
      leadMinutes: r.lead_minutes,
      maxParallel: r.max_parallel,
      approval: r.approval as "auto" | "review",
      budgetUsd: r.budget_usd,
      tags: r.tags,
      config: parseConfig(r.config),
      planMessage: r.plan_message,
      planSessionUrl: r.plan_session_url,
      accountIds,
    },
    slots: slotViews,
    counts: slotCounts(slots),
    spentUsd: spent,
    options,
  };
}

export type RoutineDetail = NonNullable<Awaited<ReturnType<typeof loadRoutineDetail>>>;
