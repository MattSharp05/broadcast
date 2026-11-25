import type { Metadata } from "next";
import { TemplateForm } from "@/features/routines/TemplateForm";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspace } from "@/lib/db/workspace";
import { EMPTY_CONFIG } from "@/lib/domain/routines";
import { loadFormOptions } from "@/lib/routines/page";

export const metadata: Metadata = { title: "New template · Broadcast" };
export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  const workspace = await currentWorkspace();
  const db = await createServerSupabase();
  const options = await loadFormOptions(db, workspace.id);
  return (
    <TemplateForm
      initial={{ id: null, name: "", description: "", config: { ...EMPTY_CONFIG } }}
      options={options}
    />
  );
}
