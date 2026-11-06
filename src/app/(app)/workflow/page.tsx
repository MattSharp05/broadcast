import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { Select } from "@/components/Select";

export const metadata: Metadata = {
  title: "Workflow · Broadcast",
};

export default function WorkflowPage() {
  return (
    <PageHeader
      title="Workflow"
      stats={[
        { value: 0, label: "scheduled" },
        { value: "none", label: "Next post", labelFirst: true },
        { value: 0, label: "posted today" },
        { value: 0, label: "failed" },
      ]}
      actions={
        <>
          <Select label="Tag" defaultValue="all">
            <option value="all">All tags</option>
          </Select>
          <Button variant="primary">
            <Plus aria-hidden="true" />
            Add content
          </Button>
        </>
      }
    />
  );
}
