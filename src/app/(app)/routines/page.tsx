import type { Metadata } from "next";
import { RoutineList } from "@/features/routines/RoutineList";
import { nowFor } from "@/lib/clock";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspace } from "@/lib/db/workspace";
import { loadFormOptions, loadRoutineList } from "@/lib/routines/page";

export const metadata: Metadata = { title: "Routines · Broadcast" };
export const dynamic = "force-dynamic";

/** The Routines tab (ADR 0009): routines and their templates. */
export default async function RoutinesPage() {
  const workspace = await currentWorkspace();
  const db = await createServerSupabase();
  const [routines, options] = await Promise.all([
    loadRoutineList(db, workspace.id),
    loadFormOptions(db, workspace.id),
  ]);
  return (
    <RoutineList
      routines={routines}
      templates={options.templates}
      timezone={workspace.timezone ?? "UTC"}
      now={nowFor(workspace).toISOString()}
    />
  );
}
