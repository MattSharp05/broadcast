import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { RoutineForm } from "@/features/routines/RoutineForm";
import { nowFor } from "@/lib/clock";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspace } from "@/lib/db/workspace";
import { toLocalInput } from "@/lib/domain/routines";
import { loadRoutineDetail } from "@/lib/routines/page";

export const metadata: Metadata = { title: "Edit routine · Broadcast" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Edit a routine that hasn't started (draft or plan ready). */
export default async function EditRoutinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const workspace = await currentWorkspace();
  const db = await createServerSupabase();
  const detail = await loadRoutineDetail(db, workspace.id, id);
  if (!detail) notFound();
  const r = detail.routine;
  if (r.status !== "draft" && r.status !== "planned") redirect(`/routines/${id}`);
  const timezone = workspace.timezone ?? "UTC";
  return (
    <RoutineForm
      initial={{
        id: r.id,
        name: r.name,
        templateId: r.templateId,
        startsAt: toLocalInput(new Date(r.startsAt), timezone),
        endsAt: toLocalInput(new Date(r.endsAt), timezone),
        postsPerDay: r.postsPerDay,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
        leadMinutes: r.leadMinutes,
        maxParallel: r.maxParallel,
        approval: r.approval,
        budgetUsd: r.budgetUsd === null ? "" : String(r.budgetUsd),
        tags: r.tags,
        accountIds: r.accountIds,
        config: r.config,
      }}
      options={detail.options}
      timezone={timezone}
      now={nowFor(workspace).toISOString()}
    />
  );
}
