import "server-only";
import { FactoryError, fail, getProduction, getSteps, updateProduction } from "@/lib/db/factory";
import type { Json } from "@/lib/db/types";
import {
  CARD_TEXT_MAX,
  estimateCards,
  parseCards,
  reorder,
  type BoardCardInput,
} from "@/lib/domain/factory/board";
import { approveStep, requestRework, type EngineContext, type StartOutcome } from "./engine";
import { logEvent } from "./studio";

/**
 * The storyboard (BC-40): cards in `board_cards`, replaced by each visuals checkpoint, edited by
 * Matthew (each edit bumps `productions.board_rev`), and approved together with the visuals step.
 */

async function bumpRev(ctx: EngineContext, productionId: string): Promise<number> {
  const p = await getProduction(ctx.db, ctx.workspaceId, productionId);
  const rev = p.board_rev + 1;
  await updateProduction(ctx.db, ctx.workspaceId, productionId, {
    board_rev: rev,
    board_approved_at: null,
  });
  return rev;
}

export async function listCards(ctx: EngineContext, productionId: string) {
  const { data, error } = await ctx.db
    .from("board_cards")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .eq("production_id", productionId)
    .order("position");
  if (error) fail("reading the board", error);
  return data;
}

/** A visuals checkpoint arrived: its cards (or ones estimated from its stills) become the board. */
export async function replaceBoard(
  ctx: EngineContext,
  productionId: string,
  output: Record<string, unknown>,
  script: Json | null,
): Promise<void> {
  const ws = ctx.workspaceId;
  const stills = Array.isArray(output.stills)
    ? (output.stills as { url?: unknown; scene?: unknown; caption?: unknown }[]).flatMap((s) =>
        typeof s.url === "string"
          ? [
              {
                url: s.url,
                scene: typeof s.scene === "string" ? s.scene : "",
                caption: typeof s.caption === "string" ? s.caption : "",
              },
            ]
          : [],
      )
    : [];
  const lines = ((script as { lines?: { text?: unknown }[] } | null)?.lines ?? []).flatMap((l) =>
    typeof l.text === "string" ? [{ text: l.text }] : [],
  );
  const cards: BoardCardInput[] = parseCards(output.cards) ?? estimateCards(stills, lines);
  const { error: delError } = await ctx.db
    .from("board_cards")
    .delete()
    .eq("workspace_id", ws)
    .eq("production_id", productionId);
  if (delError) fail("clearing the board", delError);
  if (cards.length) {
    const { error } = await ctx.db.from("board_cards").insert(
      cards.map((c, i) => ({
        workspace_id: ws,
        production_id: productionId,
        position: i,
        // An estimated card says so, so nobody mistakes it for the session's own timing.
        text: (c.estimated ? `${c.text} (estimated)` : c.text).slice(0, CARD_TEXT_MAX),
        seconds: c.seconds,
        still_path: c.still,
        scene_id: c.scene,
      })),
    );
    if (error) fail("saving the board", error);
  }
  await bumpRev(ctx, productionId);
}

async function getCard(ctx: EngineContext, productionId: string, cardId: string) {
  const { data, error } = await ctx.db
    .from("board_cards")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .eq("production_id", productionId)
    .eq("id", cardId)
    .maybeSingle();
  if (error) fail("reading the card", error);
  if (!data) throw new FactoryError("not_found", "That card isn't on this board.");
  return data;
}

async function editable(ctx: EngineContext, productionId: string) {
  const steps = await getSteps(ctx.db, ctx.workspaceId, productionId);
  const visuals = steps.find((s) => s.step === "visuals");
  if (visuals?.status !== "waiting") {
    throw new FactoryError(
      "not_waiting",
      "The board can be changed while the visuals step waits for you.",
    );
  }
}

export async function updateCard(
  ctx: EngineContext,
  productionId: string,
  cardId: string,
  patch: { text?: string; seconds?: number },
): Promise<void> {
  await editable(ctx, productionId);
  const card = await getCard(ctx, productionId, cardId);
  const update: { text?: string; seconds?: number } = {};
  if (patch.text !== undefined) update.text = patch.text.slice(0, CARD_TEXT_MAX);
  if (patch.seconds !== undefined) {
    if (!(patch.seconds > 0) || patch.seconds > 600)
      throw new FactoryError("bad_seconds", "Seconds must be more than 0 (and at most 600).");
    update.seconds = Math.round(patch.seconds * 100) / 100;
  }
  const { error } = await ctx.db
    .from("board_cards")
    .update(update)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", card.id);
  if (error) fail("saving the card", error);
  await bumpRev(ctx, productionId);
}

/** Moves a card to a new place; positions stay 0…n−1. */
export async function moveCard(
  ctx: EngineContext,
  productionId: string,
  cardId: string,
  to: number,
): Promise<void> {
  await editable(ctx, productionId);
  const cards = await listCards(ctx, productionId);
  const from = cards.findIndex((c) => c.id === cardId);
  if (from < 0) throw new FactoryError("not_found", "That card isn't on this board.");
  for (const c of reorder(cards, from, to)) {
    if (c.position === cards.find((x) => x.id === c.id)?.position) continue;
    const { error } = await ctx.db
      .from("board_cards")
      .update({ position: c.position })
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", c.id);
    if (error) fail("moving the card", error);
  }
  await bumpRev(ctx, productionId);
}

export async function deleteCard(
  ctx: EngineContext,
  productionId: string,
  cardId: string,
): Promise<void> {
  await editable(ctx, productionId);
  const card = await getCard(ctx, productionId, cardId);
  const { error } = await ctx.db
    .from("board_cards")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", card.id);
  if (error) fail("deleting the card", error);
  const rest = await listCards(ctx, productionId);
  for (const [i, c] of rest.entries()) {
    if (c.position === i) continue;
    await ctx.db
      .from("board_cards")
      .update({ position: i })
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", c.id);
  }
  await bumpRev(ctx, productionId);
}

export async function addCard(
  ctx: EngineContext,
  productionId: string,
  input: { text: string; seconds: number },
): Promise<void> {
  await editable(ctx, productionId);
  if (!(input.seconds > 0)) throw new FactoryError("bad_seconds", "Seconds must be more than 0.");
  const cards = await listCards(ctx, productionId);
  const { error } = await ctx.db.from("board_cards").insert({
    workspace_id: ctx.workspaceId,
    production_id: productionId,
    position: cards.length,
    text: input.text.slice(0, CARD_TEXT_MAX),
    seconds: Math.round(input.seconds * 100) / 100,
  });
  if (error) fail("adding the card", error);
  await bumpRev(ctx, productionId);
}

/** Approve board: approves the visuals step (the next one starts) and records the approval. */
export async function approveBoard(
  ctx: EngineContext,
  productionId: string,
): Promise<StartOutcome | null> {
  await editable(ctx, productionId);
  const ws = ctx.workspaceId;
  const { error } = await ctx.db
    .from("board_cards")
    .update({ status: "approved" })
    .eq("workspace_id", ws)
    .eq("production_id", productionId);
  if (error) fail("approving the board", error);
  await updateProduction(ctx.db, ws, productionId, {
    board_approved_at: new Date().toISOString(),
  });
  const outcome = await approveStep(ctx, productionId, "visuals");
  await logEvent(ctx, productionId, {
    actor: "matthew",
    step: "visuals",
    intent: "Approved the board.",
  });
  return outcome;
}

/** "Redo this card: …" is a scene rework for the card's scene (the visuals step reruns). */
export async function redoCard(
  ctx: EngineContext,
  productionId: string,
  cardId: string,
  note: string,
): Promise<StartOutcome | null> {
  const card = await getCard(ctx, productionId, cardId);
  if (!card.scene_id)
    throw new FactoryError("no_scene", "This card has no scene yet: edit its text instead.");
  const outcome = await requestRework(ctx, productionId, {
    target: "scene",
    ref: card.scene_id,
    note: note.trim(),
    quoteUsd: 0,
  });
  await logEvent(ctx, productionId, {
    actor: "matthew",
    step: "visuals",
    intent: `Asked to redo card ${card.position + 1} (${card.scene_id}): ${note.trim()}`,
  });
  return outcome;
}
