import "server-only";
import type { FactoryStep } from "@/lib/domain/factory/steps";

/**
 * How the dashboard runs Claude. Each production step runs in a Claude Code cloud session in the
 * video-editor repo, started through the routines API trigger:
 *   POST https://api.anthropic.com/v1/claude_code/routines/{FACTORY_ROUTINE_ID}/fire
 * with the routine's bearer token. The payload names the production and step, the Broadcast URL
 * and a scoped, expiring factory token; state lives in Broadcast's DB and the project folder.
 *
 * - Sandbox: the fake runner (engine.ts) posts canned outputs; nothing is fired.
 * - Live without FACTORY_ROUTINE_ID / FACTORY_ROUTINE_TOKEN: nothing is fired; the page shows the
 *   same payload as a prompt to paste into a session.
 */

export const ROUTINE_FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines";
export const ROUTINE_BETA = "experimental-cc-routine-2026-04-01";
export const ROUTINE_API_VERSION = "2023-06-01";

export interface FirePayload {
  productionId: string;
  step: FactoryStep;
  appUrl: string;
  token: string;
  note: string | null;
}

export type FireResult =
  | { kind: "session"; sessionId: string; sessionUrl: string }
  | { kind: "manual"; prompt: string; reason: string }
  | { kind: "error"; message: string };

/** The text a session gets: the routine's fire payload, or the prompt Matthew pastes. */
export function firePayloadText(p: FirePayload): string {
  return [
    "Broadcast Content Factory step. Follow .claude/skills/broadcast-factory/SKILL.md.",
    `BROADCAST_URL=${p.appUrl}`,
    `BROADCAST_TOKEN=${p.token}`,
    `BROADCAST_VIDEO_ID=${p.productionId}`,
    `STEP=${p.step}`,
    ...(p.note ? [`NOTE=${p.note.replace(/\s+/g, " ").slice(0, 2000)}`] : []),
  ].join("\n");
}

export function routineConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.FACTORY_ROUTINE_ID?.trim() && env.FACTORY_ROUTINE_TOKEN?.trim());
}

export async function fireRoutine(
  payload: FirePayload,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<FireResult> {
  const text = firePayloadText(payload);
  if (!routineConfigured(env)) {
    return {
      kind: "manual",
      prompt: text,
      reason:
        "The factory routine isn't set up yet (FACTORY_ROUTINE_ID and FACTORY_ROUTINE_TOKEN). Paste this into a new Claude Code session on the video-editor repo instead.",
    };
  }
  const id = encodeURIComponent((env.FACTORY_ROUTINE_ID ?? "").trim());
  const bearer = (env.FACTORY_ROUTINE_TOKEN ?? "").trim();
  try {
    const res = await fetchImpl(`${ROUTINE_FIRE_URL}/${id}/fire`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "anthropic-beta": ROUTINE_BETA,
        "anthropic-version": ROUTINE_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (
      res.ok &&
      typeof data.claude_code_session_id === "string" &&
      typeof data.claude_code_session_url === "string"
    ) {
      return {
        kind: "session",
        sessionId: data.claude_code_session_id,
        sessionUrl: data.claude_code_session_url,
      };
    }
    const err = (data.error as { message?: string } | undefined)?.message;
    const hint =
      res.status === 401
        ? " Check FACTORY_ROUTINE_TOKEN (it belongs to one routine)."
        : res.status === 404
          ? " Check FACTORY_ROUTINE_ID (it starts with trig_)."
          : res.status === 429
            ? " The routine's hourly limit was reached; try again later."
            : "";
    return {
      kind: "error",
      message: `Starting the session failed (${res.status})${err ? `: ${err}` : ""}.${hint}`,
    };
  } catch (e) {
    return {
      kind: "error",
      message: `Couldn't reach the routines API: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
