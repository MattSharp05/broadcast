import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemplateForm } from "@/features/routines/TemplateForm";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspace } from "@/lib/db/workspace";
import { loadFormOptions } from "@/lib/routines/page";

export const metadata: Metadata = { title: "Template · Broadcast" };
export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await currentWorkspace();
  const db = await createServerSupabase();
  const options = await loadFormOptions(db, workspace.id);
  const t = options.templates.find((x) => x.id === id);
  if (!t) notFound();
  return (
    <TemplateForm
      initial={{ id: t.id, name: t.name, description: t.description, config: t.config }}
      options={options}
    />
  );
}
