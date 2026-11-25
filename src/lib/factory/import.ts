import "server-only";
import { fail, type Db } from "@/lib/db/factory";
import { stepsFor } from "@/lib/domain/factory/steps";

/**
 * Imports (BC-44): video-editor projects made before the factory, brought into the studio as a
 * video whose v1 the session uploads. Kept apart from the engine: the import route takes the
 * content API key, which must never reach providers, the scheduler or stored credentials.
 */

interface ImportContext {
  db: Db;
  workspaceId: string;
  now: Date;
}

/** An imported video: every step skipped except the render that brings its v1. */
export function isImportSteps(steps: readonly { step: string; status: string }[]): boolean {
  return (
    steps.length > 0 &&
    steps.every((s) => (s.step === "render" ? s.status !== "skipped" : s.status === "skipped"))
  );
}

/**
 * A video-editor project brought into the studio (POST /api/factory/import): a production with
 * the project's slug, title, style and brief, no account yet, every step skipped but the render,
 * which waits for the session's v1. Returns the id, or the existing one for a slug imported before.
 */
export async function importProduction(
  ctx: ImportContext,
  input: { projectSlug: string; title: string; idea: string; style: string | null },
): Promise<{ id: string; existing: boolean; awaitingV1: boolean }> {
  const ws = ctx.workspaceId;
  const existing = async (): Promise<{
    id: string;
    existing: true;
    awaitingV1: boolean;
  } | null> => {
    const { data: found, error: findError } = await ctx.db
      .from("productions")
      .select("id")
      .eq("workspace_id", ws)
      .eq("project_slug", input.projectSlug)
      .maybeSingle();
    if (findError) fail("reading the videos", findError);
    if (!found) return null;
    const [steps, versions] = await Promise.all([
      ctx.db
        .from("production_steps")
        .select("step, status")
        .eq("workspace_id", ws)
        .eq("production_id", found.id),
      ctx.db
        .from("production_versions")
        .select("id")
        .eq("workspace_id", ws)
        .eq("production_id", found.id),
    ]);
    const render = (steps.data ?? []).find((s) => s.step === "render");
    const awaitingV1 =
      isImportSteps(steps.data ?? []) &&
      (versions.data ?? []).length === 0 &&
      (render?.status === "running" || render?.status === "failed");
    return { id: found.id, existing: true, awaitingV1 };
  };
  const before = await existing();
  if (before) return before;

  const { data, error } = await ctx.db
    .from("productions")
    .insert({
      workspace_id: ws,
      project_slug: input.projectSlug,
      title: input.title.slice(0, 120),
      idea: input.idea.slice(0, 2000),
      style: input.style,
      status: "running",
    })
    .select("id")
    .single();
  if (error) {
    // Imported at the same moment by another call (the unique slug index): that one wins.
    if (error.code === "23505") {
      const raced = await existing();
      if (raced) return raced;
    }
    fail("importing the video", error);
  }
  try {
    const { error: stepsError } = await ctx.db.from("production_steps").insert(
      stepsFor(false).map((step) => ({
        workspace_id: ws,
        production_id: data.id,
        step,
        status: step === "render" ? ("running" as const) : ("skipped" as const),
        message: step === "render" ? "Waiting for the imported render (v1)." : null,
        started_at: step === "render" ? ctx.now.toISOString() : null,
      })),
    );
    if (stepsError) fail("importing the video's steps", stepsError);
    const { error: eventError } = await ctx.db.from("production_events").insert({
      workspace_id: ws,
      production_id: data.id,
      actor: "system",
      step: "render",
      intent: `Imported from video-editor projects/${input.projectSlug}; waiting for its render as v1.`,
    });
    if (eventError) fail("logging the import", eventError);
  } catch (err) {
    // A half-made import would block the slug: nothing is left behind.
    await ctx.db.from("productions").delete().eq("workspace_id", ws).eq("id", data.id);
    throw err;
  }
  return { id: data.id, existing: false, awaitingV1: true };
}
