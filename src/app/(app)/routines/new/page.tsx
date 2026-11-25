import type { Metadata } from "next";
import { RoutineForm } from "@/features/routines/RoutineForm";
import { nowFor } from "@/lib/clock";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspace } from "@/lib/db/workspace";
import { newRoutineDefaults } from "@/lib/routines/form-defaults";
import { loadFormOptions } from "@/lib/routines/page";

export const metadata: Metadata = { title: "New routine · Broadcast" };
export const dynamic = "force-dynamic";

/** `?template=<id>` starts from a saved template. */
export default async function NewRoutinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const template = (await searchParams).template;
  const workspace = await currentWorkspace();
  const db = await createServerSupabase();
  const options = await loadFormOptions(db, workspace.id);
  const timezone = workspace.timezone ?? "UTC";
  const now = nowFor(workspace);
  return (
    <RoutineForm
      initial={newRoutineDefaults(
        now,
        timezone,
        options,
        typeof template === "string" ? template : null,
      )}
      options={options}
      timezone={timezone}
      now={now.toISOString()}
    />
  );
}
