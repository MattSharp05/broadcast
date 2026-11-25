import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as assetsPost } from "@/app/api/factory/[id]/assets/route";
import { GET as briefGet } from "@/app/api/factory/[id]/brief/route";
import { POST as checkpointPost } from "@/app/api/factory/[id]/checkpoint/route";
import { POST as progressPost } from "@/app/api/factory/[id]/progress/route";
import { POST as versionsPost } from "@/app/api/factory/[id]/versions/route";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { approveBoard, deleteCard, moveCard, redoCard, updateCard } from "@/lib/factory/board";
import { createProduction, mintFactoryToken } from "@/lib/factory/engine";
import {
  addNote,
  addVersion,
  deleteNote,
  editNote,
  fakeVersionMedia,
  markReady,
  packChecks,
  saveCover,
  savePack,
  reopenNote,
  resolveNote,
  sendNotes,
} from "@/lib/factory/studio";
import { stableUuid } from "@/lib/hash";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { adminClient } from "./helpers";

// BC-36: versions, revise batches and intents (docs/factory-api.md → Versions and revise) against
// the local stack. The Sandbox's fake runner answers sent batches at once.

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");
const ctx = { db: admin, workspaceId: SANDBOX, now: NOW };

async function load(name: string) {
  const s = getScenario(name);
  if (!s) throw new Error(name);
  await loadScenario(admin, s, { fixedNow: NOW });
}

function call<P>(
  handler: (r: NextRequest, c: { params: Promise<P> }) => Promise<Response>,
  params: P,
  token: string | null,
  body?: unknown,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return handler(
    new NextRequest("http://localhost/api/x", {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  );
}

async function upload(id: string, token: string): Promise<string> {
  const asked = await call(assetsPost, { id }, token, {
    name: "final.mp4",
    content_type: "video/mp4",
  });
  const { path, upload_url } = (await asked.json()) as { path: string; upload_url: string };
  const put = await fetch(upload_url, {
    method: "PUT",
    headers: { "content-type": "video/mp4" },
    body: readFileSync(join(process.cwd(), "tests/fixtures/video", "reel-9x16.mp4")),
  });
  expect(put.ok).toBe(true);
  return path;
}

async function versionsOf(id: string) {
  const { data } = await admin
    .from("production_versions")
    .select("*")
    .eq("production_id", id)
    .order("number");
  return data ?? [];
}

describe("render checkpoints make versions", () => {
  const render = stableUuid("factory-pipeline", "production", "render");
  let token = "";

  beforeEach(async () => {
    await load("factory-pipeline");
    token = await mintFactoryToken(ctx, render);
  });

  it("keeps every render as the next version, with its git sha and proxy, and v1's file", async () => {
    const first = await upload(render, token);
    const proxy = await upload(render, token);
    const res = await call(checkpointPost, { id: render }, token, {
      step: "render",
      intent: "First render of the merge explainer.",
      output: {
        upload: first,
        proxy,
        git_sha: "abc1234",
        fps: 30,
        loudness_lufs: -14.2,
        duration_s: 12,
        face_share: null,
        imagery_credits: [],
      },
    });
    expect(res.status).toBe(200);
    // Render again (the step back to running, as a redo would).
    await admin
      .from("production_steps")
      .update({ status: "running" })
      .eq("production_id", render)
      .eq("step", "render");
    const second = await upload(render, token);
    expect(
      (
        await call(checkpointPost, { id: render }, token, {
          step: "render",
          output: { upload: second, git_sha: "def5678", duration_s: 12, face_share: null },
        })
      ).status,
    ).toBe(200);

    const versions = await versionsOf(render);
    expect(versions.map((v) => [v.number, v.git_sha, v.made_by])).toEqual([
      [1, "abc1234", "render"],
      [2, "def5678", "render"],
    ]);
    expect(versions[0]).toMatchObject({ proxy_path: proxy, fps: 30, loudness_lufs: -14.2 });
    const v1Media = await admin
      .from("media_assets")
      .select("id")
      .eq("id", versions[0]?.media_id ?? "");
    expect(v1Media.data).toHaveLength(1);
    const p = await admin.from("productions").select("media_id").eq("id", render).single();
    expect(p.data?.media_id).toBe(versions[1]?.media_id);
    const events = await admin
      .from("production_events")
      .select("actor, step, intent")
      .eq("production_id", render);
    expect(events.data).toContainEqual({
      actor: "session",
      step: "render",
      intent: "First render of the merge explainer.",
    });
  });

  it("refuses a render without a git sha, and logs a progress intent (cut to 160)", async () => {
    const first = await upload(render, token);
    const res = await call(checkpointPost, { id: render }, token, {
      step: "render",
      output: { upload: first, duration_s: 12 },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "missing_git_sha" });
    expect(await versionsOf(render)).toEqual([]);

    const progress = await call(progressPost, { id: render }, token, {
      step: "render",
      progress: 40,
      message: "Scene 2",
      intent: "x".repeat(300),
    });
    expect(progress.status).toBe(204);
    const events = await admin
      .from("production_events")
      .select("intent")
      .eq("production_id", render)
      .eq("actor", "session");
    expect(events.data?.[0]?.intent).toHaveLength(160);
  });
});

describe("pruning", () => {
  const pid = stableUuid("factory-versions", "production", "tides");

  it("keeps the posted v1 whole and prunes the oldest unposted draft as v3…v6 arrive", async () => {
    await load("factory-versions");
    const [v1] = await versionsOf(pid);
    const account = stableUuid("factory-versions", "account", "cj");
    const post = await admin
      .from("posts")
      .insert({
        workspace_id: SANDBOX,
        account_id: account,
        media_id: v1?.media_id ?? "",
        caption: "v1",
        timing: "queue",
      })
      .select("id")
      .single();
    expect(post.error).toBeNull();
    await admin
      .from("productions")
      .update({ post_id: post.data?.id, media_id: v1?.media_id, status: "scheduled" })
      .eq("id", pid);

    for (let n = 3; n <= 6; n++) {
      const media = await fakeVersionMedia(ctx, pid, n, null);
      await addVersion(ctx, pid, { mediaId: media, gitSha: `sha${n}`, madeBy: "render" });
    }
    const versions = await versionsOf(pid);
    const byNumber = (n: number) => versions.find((v) => v.number === n);
    expect(byNumber(1)).toMatchObject({ media_id: v1?.media_id, pruned_at: null });
    expect(byNumber(2)?.media_id).toBeNull();
    expect(byNumber(2)?.proxy_path).toBeNull();
    expect(byNumber(2)?.pruned_at).not.toBeNull();
    // The newest draft keeps its file; the chosen version stays the posted one.
    expect(byNumber(6)?.media_id).not.toBeNull();
    const p = await admin.from("productions").select("media_id").eq("id", pid).single();
    expect(p.data?.media_id).toBe(v1?.media_id);
    const system = await admin
      .from("production_events")
      .select("intent")
      .eq("production_id", pid)
      .eq("actor", "system");
    expect(system.data?.length).toBeGreaterThan(0);
  });
});

describe("revise batches", () => {
  const sentId = stableUuid("factory-batch-sent", "production", "tides");
  const batchId = stableUuid("factory-batch-sent", "batch", "1");
  const note = (n: number) => stableUuid("factory-batch-sent", "note", String(n));

  it("puts the versions and the open batch in the brief", async () => {
    await load("factory-batch-sent");
    const token = await mintFactoryToken(ctx, sentId);
    const res = await call(briefGet, { id: sentId }, token);
    const brief = (await res.json()) as {
      versions: { number: number; url: string | null; git_sha: string }[];
      batch: { id: string; version_number: number; notes: { number: number; frame: number }[] };
    };
    expect(brief.versions.map((v) => v.number)).toEqual([2, 1]);
    expect(brief.versions[0]?.url).toContain("/factory/fake/version-2.mp4");
    expect(brief.batch).toMatchObject({ id: batchId, version_number: 2 });
    expect(brief.batch.notes.map((n) => n.number)).toEqual([1, 2, 3]);
    expect(brief.batch.notes[0]?.frame).toBe(96);
  });

  it("refuses incomplete answers without changing anything, then takes a full set", async () => {
    await load("factory-batch-sent");
    const token = await mintFactoryToken(ctx, sentId);
    const file = await upload(sentId, token);
    const answer = (n: number) => ({ note_id: note(n), verdict: "answered", reply: `Done ${n}.` });
    const missing = await call(versionsPost, { id: sentId }, token, {
      batch_id: batchId,
      upload: file,
      git_sha: "f00ba44",
      answers: [answer(1), answer(2)],
    });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ error: "answers_incomplete" });
    expect(await versionsOf(sentId)).toHaveLength(2);
    const still = await admin.from("review_notes").select("status").eq("batch_id", batchId);
    expect(still.data?.every((n) => n.status === "sent")).toBe(true);

    const ok = await call(versionsPost, { id: sentId }, token, {
      batch_id: batchId,
      upload: file,
      git_sha: "f00ba44",
      intent: "Moved the title in and enlarged the label.",
      answers: [
        answer(1),
        answer(2),
        { note_id: note(3), verdict: "not_changed", reply: "Already 18 dB under the voice." },
      ],
    });
    expect(ok.status).toBe(201);
    const created = (await ok.json()) as { version: string; number: number };
    expect(created.number).toBe(3);
    const notes = await admin
      .from("review_notes")
      .select("number, status, reply, answered_in_version")
      .eq("batch_id", batchId)
      .order("number");
    expect(notes.data?.map((n) => n.status)).toEqual(["answered", "answered", "not_changed"]);
    expect(notes.data?.every((n) => n.answered_in_version === created.version)).toBe(true);
    const batch = await admin.from("review_batches").select("*").eq("id", batchId).single();
    expect(batch.data).toMatchObject({ status: "answered", answered_by_version: created.version });
    const [, , v3] = await versionsOf(sentId);
    expect(v3).toMatchObject({ made_by: "revise", batch_id: batchId, git_sha: "f00ba44" });

    // The batch is closed now.
    const again = await call(versionsPost, { id: sentId }, token, {
      batch_id: batchId,
      upload: file,
      git_sha: "f00ba44",
      answers: [answer(1), answer(2), answer(3)],
    });
    expect(again.status).toBe(409);
  });

  it("refuses another video's token (403) and another video's batch (403)", async () => {
    await load("factory-batch-sent");
    const other = await createProduction(ctx, { idea: "Another video" });
    const otherToken = await mintFactoryToken(ctx, other);
    const wrongVideo = await call(versionsPost, { id: sentId }, otherToken, {
      batch_id: batchId,
      git_sha: "x",
      answers: [],
    });
    expect(wrongVideo.status).toBe(403);
    const wrongBatch = await call(versionsPost, { id: other }, otherToken, {
      batch_id: batchId,
      git_sha: "x",
      answers: [],
    });
    expect(wrongBatch.status).toBe(403);
    expect(await wrongBatch.json()).toMatchObject({ error: "wrong_batch" });
  });

  it("allows one open batch per video", async () => {
    await load("factory-batch-sent");
    const v2 = stableUuid("factory-batch-sent", "version", "2");
    await expect(sendNotes(ctx, sentId, v2)).rejects.toMatchObject({ code: "batch_open" });
  });

  it("sends draft notes and the fake runner answers with the next version", async () => {
    await load("factory-versions");
    const pid = stableUuid("factory-versions", "production", "tides");
    const v2 = stableUuid("factory-versions", "version", "2");
    await admin.from("review_notes").insert({
      workspace_id: SANDBOX,
      production_id: pid,
      version_id: v2,
      number: 1,
      kind: "general",
      text: "Warmer colours in the last scene.",
    });
    const outcome = await sendNotes(ctx, pid, v2);
    expect(outcome.kind).toBe("fake");
    const versions = await versionsOf(pid);
    expect(versions.map((v) => v.number)).toEqual([1, 2, 3]);
    expect(versions[2]).toMatchObject({ made_by: "revise", batch_id: outcome.batchId });
    const notes = await admin.from("review_notes").select("status, reply").eq("version_id", v2);
    expect(notes.data?.[0]?.status).toBe("answered");
    expect(notes.data?.[0]?.reply).toContain("Warmer colours");
    const feed = await admin
      .from("production_events")
      .select("actor, intent")
      .eq("production_id", pid)
      .eq("step", "revise");
    expect(feed.data?.map((e) => e.actor)).toEqual(expect.arrayContaining(["matthew", "session"]));
  });
});

describe("notes on a version (the Versions tab)", () => {
  const pid = stableUuid("factory-versions", "production", "tides");
  const v2 = stableUuid("factory-versions", "version", "2");

  it("adds, edits and deletes drafts with stable numbers and the frame at the version's fps", async () => {
    await load("factory-versions");
    const a = await addNote(ctx, pid, v2, {
      kind: "moment",
      tS: 3.2,
      box: null,
      text: "Title late",
      cropPath: null,
    });
    const b = await addNote(ctx, pid, v2, {
      kind: "region",
      tS: 12.5,
      box: { x: 0.1, y: 0.6, w: 0.4, h: 0.2 },
      text: "Bigger label",
      cropPath: `storage:factory/${SANDBOX}/${pid}/notes/x.jpg`,
    });
    expect([a.number, b.number]).toEqual([1, 2]);
    await expect(
      addNote(ctx, pid, v2, { kind: "region", tS: 1, box: null, text: "x", cropPath: null }),
    ).rejects.toMatchObject({ code: "bad_note" });
    await expect(
      addNote(ctx, pid, v2, {
        kind: "general",
        tS: null,
        box: null,
        text: "x",
        cropPath: `storage:factory/${SANDBOX}/another/x.jpg`,
      }),
    ).rejects.toMatchObject({ code: "bad_crop" });
    await editNote(ctx, pid, a.id, "Title lands late");
    await deleteNote(ctx, pid, a.id);
    const c = await addNote(ctx, pid, v2, {
      kind: "general",
      tS: null,
      box: null,
      text: "Music",
      cropPath: null,
    });
    expect(c.number).toBe(3);
    const rows = await admin
      .from("review_notes")
      .select("number, frame, text")
      .eq("version_id", v2)
      .order("number");
    expect(rows.data).toEqual([
      { number: 2, frame: 375, text: "Bigger label" },
      { number: 3, frame: null, text: "Music" },
    ]);
  });

  it("refuses to change a sent note; resolves or reopens an answered one on the answering version", async () => {
    await load("factory-batch-answered");
    const pa = stableUuid("factory-batch-answered", "production", "tides");
    const note = (n: number) => stableUuid("factory-batch-answered", "note", String(n));
    await expect(editNote(ctx, pa, note(1), "changed")).rejects.toMatchObject({ code: "sent" });
    await expect(deleteNote(ctx, pa, note(1))).rejects.toMatchObject({ code: "sent" });
    await resolveNote(ctx, pa, note(1));
    const reopened = await reopenNote(ctx, pa, note(2));
    const row = await admin
      .from("review_notes")
      .select("version_id, status, kind, number")
      .eq("id", reopened.id)
      .single();
    expect(row.data).toMatchObject({
      version_id: stableUuid("factory-batch-answered", "version", "3"),
      status: "draft",
      kind: "region",
      number: 1,
    });
    const resolved = await admin.from("review_notes").select("status").eq("id", note(1)).single();
    expect(resolved.data?.status).toBe("resolved");
  });
});

describe("delivery packs (Ready to post)", () => {
  it("refuses Mark ready while a check fails, then saves the pack, the cover and the manifest", async () => {
    await load("factory-ready-to-post");
    const pid = stableUuid("factory-ready-to-post", "production", "tides");
    const v3 = stableUuid("factory-ready-to-post", "version", "3");
    await expect(markReady(ctx, pid, v3)).rejects.toMatchObject({ code: "not_ready" });
    await saveCover(ctx, pid, v3, 2.5);
    await savePack(ctx, pid, v3, {
      caption:
        (await admin.from("productions").select("caption").eq("id", pid).single()).data?.caption ??
        "",
      hashtags: ["#Tides", "moon", "tides", "two words"],
    });
    await markReady(ctx, pid, v3);
    const pack = await admin.from("delivery_packs").select("*").eq("version_id", v3).single();
    expect(pack.data?.hashtags).toEqual(["Tides", "moon", "two", "words"]);
    expect(pack.data?.ready_at).not.toBeNull();
    expect(pack.data?.cover_path).toBe(`${SANDBOX}/covers/${v3}.jpg`);
    expect(pack.data?.manifest).toMatchObject({ version: 3, git_sha: "c52e118" });
    const media = await admin
      .from("media_assets")
      .select("cover_path")
      .eq("id", stableUuid("factory-ready-to-post", "media", "tides"))
      .single();
    expect(media.data?.cover_path).toBe(`${SANDBOX}/covers/${v3}.jpg`);
    // Any change unmarks it.
    await savePack(ctx, pid, v3, { caption: "Changed", hashtags: [] });
    const after = await admin
      .from("delivery_packs")
      .select("ready_at")
      .eq("version_id", v3)
      .single();
    expect(after.data?.ready_at).toBeNull();
  });

  it("names the failing checks for a 95 s version without its music credit", async () => {
    await load("factory-ready-failing");
    const pid = stableUuid("factory-ready-failing", "production", "tides");
    const v3 = stableUuid("factory-ready-failing", "version", "3");
    const { checks } = await packChecks(ctx, pid, v3);
    expect(checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(["duration", "credits"]);
    await expect(markReady(ctx, pid, v3)).rejects.toMatchObject({ code: "not_ready" });
  });
});

describe("storyboard (Board tab)", () => {
  const pid = stableUuid("factory-board", "production", "tides");

  it("estimates cards from the stills when a visuals checkpoint sends none, and bumps the rev", async () => {
    await load("factory-board");
    const token = await mintFactoryToken(ctx, pid);
    await admin
      .from("production_steps")
      .update({ status: "running" })
      .eq("production_id", pid)
      .eq("step", "visuals");
    const res = await call(checkpointPost, { id: pid }, token, {
      step: "visuals",
      intent: "Four stills, one per scene.",
      output: {
        stills: [1, 2, 3, 4].map((n) => ({
          url: `/factory/fake/still-${n}.svg`,
          scene: `s${n}`,
          caption: `Scene ${n}`,
        })),
      },
    });
    expect(res.status).toBe(200);
    const cards = await admin
      .from("board_cards")
      .select("position, text, scene_id, seconds")
      .eq("production_id", pid)
      .order("position");
    expect(cards.data?.map((c) => c.scene_id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(cards.data?.[0]?.text).toBe("Scene 1 (estimated)");
    expect(cards.data?.every((c) => c.seconds > 0)).toBe(true);
    const p = await admin.from("productions").select("board_rev").eq("id", pid).single();
    expect(p.data?.board_rev).toBe(2);
    const brief = (await (await call(briefGet, { id: pid }, token)).json()) as {
      board: { rev: number; cards: unknown[] };
    };
    expect(brief.board.rev).toBe(2);
    expect(brief.board.cards).toHaveLength(4);
  });

  it("moves, edits and deletes cards with contiguous positions; approving starts the next step", async () => {
    await load("factory-board");
    const card = (n: number) => stableUuid("factory-board", "card", String(n));
    await moveCard(ctx, pid, card(4), 2);
    await updateCard(ctx, pid, card(2), { seconds: 9 });
    await deleteCard(ctx, pid, card(1));
    const rows = await admin
      .from("board_cards")
      .select("id, position, seconds")
      .eq("production_id", pid)
      .order("position");
    expect(rows.data?.map((r) => r.position)).toEqual([0, 1, 2, 3]);
    expect(rows.data?.map((r) => r.id)).toEqual([card(2), card(4), card(3), card(5)]);
    await approveBoard(ctx, pid);
    const steps = await admin
      .from("production_steps")
      .select("step, status")
      .eq("production_id", pid)
      .in("step", ["visuals", "render"]);
    expect(Object.fromEntries((steps.data ?? []).map((s) => [s.step, s.status]))).toEqual({
      visuals: "approved",
      render: "waiting",
    });
    await expect(updateCard(ctx, pid, card(2), { seconds: 3 })).rejects.toMatchObject({
      code: "not_waiting",
    });
  });

  it("redoing one card replaces only that scene's card and keeps the other edits", async () => {
    await load("factory-board");
    const card = (n: number) => stableUuid("factory-board", "card", String(n));
    await updateCard(ctx, pid, card(1), { text: "My own opening line." });
    await redoCard(ctx, pid, card(3), "Slower, so each label reads");
    const rows = await admin
      .from("board_cards")
      .select("id, position, scene_id, text")
      .eq("production_id", pid)
      .order("position");
    expect(rows.data?.map((r) => r.scene_id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(rows.data?.[0]).toMatchObject({ id: card(1), text: "My own opening line." });
    // s3 is a new card from the rerun; the others are the same rows.
    expect(rows.data?.[2]?.id).not.toBe(card(3));
    expect(rows.data?.[3]?.id).toBe(card(4));
    const rework = await admin
      .from("production_reworks")
      .select("target, ref, note")
      .eq("production_id", pid)
      .single();
    expect(rework.data).toEqual({
      target: "scene",
      ref: "s3",
      note: "Slower, so each label reads",
    });

    await approveBoard(ctx, pid);
    const approved = await admin.from("board_cards").select("status").eq("production_id", pid);
    expect(approved.data?.every((c) => c.status === "approved")).toBe(true);
    const p = await admin.from("productions").select("board_approved_at").eq("id", pid).single();
    expect(p.data?.board_approved_at).not.toBeNull();
  });
});
