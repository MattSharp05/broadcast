import "server-only";
import { ago, whenLabel } from "@/lib/domain/format";
import type { EventActor } from "@/lib/domain/factory/events";
import type { NoteBox, NoteKind, NoteStatus } from "@/lib/domain/factory/notes";
import { DEFAULT_FPS } from "@/lib/domain/factory/player";
import { signedUrlFor } from "@/lib/factory/assets";
import { videoCredits } from "@/lib/factory/studio";
import { createAdminSupabase } from "./admin";
import { fail } from "./factory";
import { createServerSupabase } from "./server";
import { VIDEOS_BUCKET } from "./videos";
import { currentWorkspace } from "./workspace";
import { nowFor } from "@/lib/clock";

/**
 * What the studio tabs of a video page show (BC-37): its versions with playable links, the review
 * notes and batches, and the activity feed. Reads as the signed-in user (RLS); links are signed.
 */

export interface VersionView {
  id: string;
  number: number;
  madeBy: string;
  intent: string;
  /** "Today, 19:00". */
  when: string;
  fps: number;
  durationS: number | null;
  gitSha: string;
  /** Proxy or full file, signed; null once pruned. */
  url: string | null;
  pruned: boolean;
  width: number | null;
  height: number | null;
  bytes: number | null;
  loudnessLufs: number | null;
  truePeakDb: number | null;
  /** The full file's media asset (scheduling and covers use it). */
  mediaId: string | null;
}

export interface PackView {
  versionId: string;
  /** Storage path of the cover (videos bucket) and a signed link to show it. */
  coverPath: string | null;
  coverUrl: string | null;
  coverTS: number | null;
  caption: string;
  hashtags: string[];
  readyAt: string | null;
  /** "Today, 19:00" once ready. */
  readyWhen: string | null;
}

export interface NoteView {
  id: string;
  versionId: string;
  number: number;
  kind: NoteKind;
  tS: number | null;
  frame: number | null;
  box: NoteBox | null;
  text: string;
  status: NoteStatus;
  reply: string | null;
  /** "v3" when a version answered it. */
  answeredIn: number | null;
  cropUrl: string | null;
}

export interface BatchView {
  id: string;
  versionId: string;
  status: string;
  sessionUrl: string | null;
  noteCount: number;
}

export interface EventView {
  id: string;
  actor: EventActor;
  step: string | null;
  intent: string;
  when: string;
  ago: string;
  sessionUrl: string | null;
}

export interface CardView {
  id: string;
  position: number;
  text: string;
  seconds: number;
  stillUrl: string | null;
  sceneId: string | null;
  status: string;
}

export interface BoardView {
  cards: CardView[];
  rev: number;
  approvedWhen: string | null;
  /** The visuals step's status: the board is editable while it waits. */
  visuals: string | null;
}

export interface StudioData {
  board: BoardView;
  versions: VersionView[];
  notes: NoteView[];
  /** The batch that is still with Claude, if any (one per video). */
  openBatch: BatchView | null;
  events: EventView[];
  /** A step is running or a batch is open: the page polls. */
  live: boolean;
  /** One delivery pack per version that has one (BC-39). */
  packs: PackView[];
  /** Every credit line the caption must carry (music, voice, avatar, imagery). */
  credits: string[];
  /** Posts of this video are flagged as AI-generated (an avatar video). */
  aiFlag: boolean;
}

const SIGN_TTL_S = 2 * 60 * 60;

export async function loadStudio(productionId: string): Promise<StudioData> {
  const db = await createServerSupabase();
  const workspace = await currentWorkspace();
  const ws = workspace.id;
  const now = nowFor(workspace);
  const timezone = workspace.timezone ?? "UTC";
  const production = await db
    .from("productions")
    .select("id, use_avatar, voice_key, music_key, board_rev, board_approved_at")
    .eq("workspace_id", ws)
    .eq("id", productionId)
    .single();
  if (production.error) fail("reading the video", production.error);
  const board = await loadBoard(db, ws, productionId);
  const [versions, notes, batches, events, running, packs, credits] = await Promise.all([
    db
      .from("production_versions")
      .select("*")
      .eq("workspace_id", ws)
      .eq("production_id", productionId)
      .order("number", { ascending: false }),
    db
      .from("review_notes")
      .select("*")
      .eq("workspace_id", ws)
      .eq("production_id", productionId)
      .order("number"),
    db
      .from("review_batches")
      .select("*")
      .eq("workspace_id", ws)
      .eq("production_id", productionId)
      .order("sent_at", { ascending: false }),
    db
      .from("production_events")
      .select("*")
      .eq("workspace_id", ws)
      .eq("production_id", productionId)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("production_steps")
      .select("step", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("production_id", productionId)
      .eq("status", "running"),
    db.from("delivery_packs").select("*").eq("workspace_id", ws).eq("production_id", productionId),
    videoCredits(db, ws, production.data),
  ]);
  for (const r of [versions, notes, batches, events, running, packs])
    if (r.error) fail("reading the studio", r.error);
  const vRows = versions.data ?? [];
  const nRows = notes.data ?? [];
  const bRows = batches.data ?? [];
  const eRows = events.data ?? [];

  const admin = createAdminSupabase();
  const mediaIds = vRows.map((v) => v.media_id).filter((m): m is string => Boolean(m));
  const paths = new Map<string, string>();
  if (mediaIds.length) {
    const media = await db
      .from("media_assets")
      .select("id, storage_path")
      .eq("workspace_id", ws)
      .in("id", mediaIds);
    if (media.error) fail("reading the versions' files", media.error);
    for (const m of media.data) paths.set(m.id, m.storage_path);
  }
  const sign = async (value: string | null | undefined): Promise<string | null> => {
    if (!value) return null;
    if (value.startsWith("storage:")) {
      const url = await signedUrlFor(admin, value, ws, SIGN_TTL_S);
      return url.startsWith("storage:") ? null : url;
    }
    if (value.startsWith(`${ws}/`)) {
      const { data } = await admin.storage.from(VIDEOS_BUCKET).createSignedUrl(value, SIGN_TTL_S);
      return data?.signedUrl ?? null;
    }
    return value.startsWith("/") || value.startsWith("https://") ? value : null;
  };

  const numberOf = new Map(vRows.map((v) => [v.id, v.number]));
  const open = bRows.find((b) => b.status === "sent" || b.status === "running") ?? null;
  return {
    board: {
      rev: production.data.board_rev,
      approvedWhen: production.data.board_approved_at
        ? whenLabel(new Date(production.data.board_approved_at), now, timezone)
        : null,
      visuals: board.visuals,
      cards: await Promise.all(
        board.cards.map(async (c) => ({
          id: c.id,
          position: c.position,
          text: c.text,
          seconds: c.seconds,
          stillUrl: await sign(c.still_path),
          sceneId: c.scene_id,
          status: c.status,
        })),
      ),
    },
    versions: await Promise.all(
      vRows.map(async (v) => ({
        id: v.id,
        number: v.number,
        madeBy: v.made_by,
        intent: v.intent,
        when: whenLabel(new Date(v.created_at), now, timezone),
        fps: v.fps ?? DEFAULT_FPS,
        durationS: v.duration_s,
        gitSha: v.git_sha,
        url: await sign(v.proxy_path ?? (v.media_id ? paths.get(v.media_id) : null)),
        pruned: v.pruned_at !== null && !v.proxy_path && !v.media_id,
        width: v.width,
        height: v.height,
        bytes: v.bytes,
        loudnessLufs: v.loudness_lufs,
        truePeakDb: v.true_peak_db,
        mediaId: v.media_id,
      })),
    ),
    notes: await Promise.all(
      nRows.map(async (n) => ({
        id: n.id,
        versionId: n.version_id,
        number: n.number,
        kind: n.kind as NoteKind,
        tS: n.t_s,
        frame: n.frame,
        box: (n.box as NoteBox | null) ?? null,
        text: n.text,
        status: n.status as NoteStatus,
        reply: n.reply,
        answeredIn: n.answered_in_version ? (numberOf.get(n.answered_in_version) ?? null) : null,
        cropUrl: await sign(n.crop_path),
      })),
    ),
    openBatch: open
      ? {
          id: open.id,
          versionId: open.version_id,
          status: open.status,
          sessionUrl: open.session_url,
          noteCount: nRows.filter((n) => n.batch_id === open.id).length,
        }
      : null,
    events: eRows.map((e) => ({
      id: e.id,
      actor: e.actor as EventActor,
      step: e.step,
      intent: e.intent,
      when: whenLabel(new Date(e.created_at), now, timezone),
      ago: ago(new Date(e.created_at), now),
      sessionUrl: e.session_url,
    })),
    live: Boolean(open) || (running.count ?? 0) > 0,
    packs: await Promise.all(
      (packs.data ?? []).map(async (k) => ({
        versionId: k.version_id,
        coverPath: k.cover_path,
        coverUrl: await sign(k.cover_path),
        coverTS: k.cover_t_s,
        caption: k.caption,
        hashtags: k.hashtags,
        readyAt: k.ready_at,
        readyWhen: k.ready_at ? whenLabel(new Date(k.ready_at), now, timezone) : null,
      })),
    ),
    credits,
    aiFlag: production.data.use_avatar,
  };
}

async function loadBoard(
  db: Awaited<ReturnType<typeof createServerSupabase>>,
  ws: string,
  id: string,
) {
  const [cards, visuals] = await Promise.all([
    db
      .from("board_cards")
      .select("*")
      .eq("workspace_id", ws)
      .eq("production_id", id)
      .order("position"),
    db
      .from("production_steps")
      .select("status")
      .eq("workspace_id", ws)
      .eq("production_id", id)
      .eq("step", "visuals")
      .maybeSingle(),
  ]);
  if (cards.error) fail("reading the board", cards.error);
  return { cards: cards.data, visuals: visuals.data?.status ?? null };
}
