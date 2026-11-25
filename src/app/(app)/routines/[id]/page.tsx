import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RoutineView } from "@/features/routines/RoutineView";
import { nowFor } from "@/lib/clock";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspace } from "@/lib/db/workspace";
import { loadRoutineDetail } from "@/lib/routines/page";

export const metadata: Metadata = { title: "Routine · Broadcast" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One routine: its plan (a brief per slot), progress, and the approval of finished videos. */
export default async function RoutinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const workspace = await currentWorkspace();
  const db = await createServerSupabase();
  const detail = await loadRoutineDetail(db, workspace.id, id);
  if (!detail) notFound();
  return (
    <RoutineView
      detail={detail}
      timezone={workspace.timezone ?? "UTC"}
      now={nowFor(workspace).toISOString()}
    />
  );
}
