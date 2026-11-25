import "server-only";
import { FactoryError, fail, getProduction, getSteps, updateProduction } from "@/lib/db/factory";
import type { Json } from "@/lib/db/types";
import {
  CARD_TEXT_MAX,
  cardSeconds,
  estimateCards,
  estimatedText,
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
  /** A scene rework: only that scene's cards are replaced; Matthew's other edits stay. */
  onlyScene: string | null = null,
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
  const old = await listCards(ctx, productionId);
  const row = (c: BoardCardInput, position: number) => ({
    workspace_id: ws,
    production_id: productionId,
    position,
    text: c.estimated ? estimatedText(c.text) : c.text.slice(0, CARD_TEXT_MAX),
    seconds: c.seconds,
    still_path: c.still,
    scene_id: c.scene,
  });

  if (onlyScene && old.length) {
    const fresh = cards.filter((c) => c.scene === onlyScene);
    const mine = old.filter((c) => c.scene_id === onlyScene);
    if (!fresh.length || !mine.length) {
      await bumpRev(ctx, productionId);
      return;
    }
    // The redone scene's cards take its first card's place; everything else stays as edited.
    const at = Math.min(...mine.map((c) => c.position));
    const keep = old.filter((c) => c.scene_id !== onlyScene);
    const before = keep.filter((c) => c.position < at);
    const after = keep.filter((c) => c.position > at);
    const { error } = await ctx.db
      .from("board_cards")
      .insert(fresh.map((c, i) => row(c, before.length + i)));
    if (error) fail("saving the board", error);
    await removeCards(
      ctx,
      mine.map((c) => c.id),
    );
    await renumber(ctx, [...before, ...after], (c) =>
      c.position < at ? before.indexOf(c) : before.length + fresh.length + after.indexOf(c),
    );
    await bumpRev(ctx, productionId);
    return;
  }

  // New cards go in before the old ones go, so a failed insert never leaves an empty board.
  if (cards.length) {
    const { error } = await ctx.db.from("board_cards").insert(cards.map((c, i) => row(c, i)));
    if (error) fail("saving the board", error);
  }
  await removeCards(
    ctx,
    old.map((c) => c.id),
  );
  await bumpRev(ctx, productionId);
}

async function removeCards(ctx: EngineContext, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await ctx.db
    .from("board_cards")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .in("id", ids);
  if (error) fail("clearing the old board", error);
}

/** Sets each card's position from `at` (only rows whose position changes are written). */
async function renumber<T extends { id: string; position: number }>(
  ctx: EngineContext,
  cards: readonly T[],
  at: (c: T) => number,
): Promise<void> {
  for (const c of cards) {
    const position = at(c);
    if (position === c.position) continue;
    const { error } = await ctx.db
      .from("board_cards")
      .update({ position })
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", c.id);
    if (error) fail("moving the cards", error);
  }
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
    const seconds = cardSeconds(patch.seconds);
    if (seconds === null)
      throw new FactoryError("bad_seconds", "Seconds must be between 0.01 and 600.");
    update.seconds = seconds;
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
  const order = reorder(cards, from, to);
  await renumber(ctx, cards, (c) => order.find((o) => o.id === c.id)?.position ?? c.position);
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
  await renumber(ctx, rest, (c) => rest.indexOf(c));
  await bumpRev(ctx, productionId);
}

export async function addCard(
  ctx: EngineContext,
  productionId: string,
  input: { text: string; seconds: number },
): Promise<void> {
  await editable(ctx, productionId);
  const seconds = cardSeconds(input.seconds);
  if (seconds === null)
    throw new FactoryError("bad_seconds", "Seconds must be between 0.01 and 600.");
  const cards = await listCards(ctx, productionId);
  const { error } = await ctx.db.from("board_cards").insert({
    workspace_id: ctx.workspaceId,
    production_id: productionId,
    position: cards.length,
    text: input.text.slice(0, CARD_TEXT_MAX),
    seconds,
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
  await editable(ctx, productionId);
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

/** Approving the visuals step (Board tab, Make tab or autopilot) approves its board. */
export async function markBoardApproved(ctx: EngineContext, productionId: string): Promise<void> {
  const { error } = await ctx.db
    .from("board_cards")
    .update({ status: "approved" })
    .eq("workspace_id", ctx.workspaceId)
    .eq("production_id", productionId);
  if (error) fail("approving the board", error);
  await updateProduction(ctx.db, ctx.workspaceId, productionId, {
    board_approved_at: ctx.now.toISOString(),
  });
}
