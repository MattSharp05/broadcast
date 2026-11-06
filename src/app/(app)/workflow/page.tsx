import type { Metadata } from "next";
import { WorkflowView } from "@/features/canvas/content/WorkflowView";
import { loadWorkflow } from "@/lib/db/canvas";
import { addContent, postNowAction, removePostAction, savePost, saveSlots } from "./actions";

export const metadata: Metadata = {
  title: "Workflow · Broadcast",
};

/** The Workflow tab: every account's timeline around "now" on the canvas (one loader). */
export default async function WorkflowPage() {
  const data = await loadWorkflow();
  return (
    <WorkflowView
      columns={data.columns}
      stats={data.stats}
      now={data.now}
      frozen={data.frozen}
      timezone={data.timezone}
      details={data.details}
      contentAccounts={data.contentAccounts}
      addContent={addContent}
      queueActions={{ savePost, postNow: postNowAction, removePost: removePostAction, saveSlots }}
    />
  );
}
