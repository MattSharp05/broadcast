import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { FactoryPlaceholder } from "@/features/factory/FactoryPlaceholder";

export const metadata: Metadata = {
  title: "Content Factory · Broadcast",
};

export default function FactoryPage() {
  return (
    <>
      <PageHeader
        title="Content Factory"
        actions={
          <Button disabled title="Coming in v1">
            <Plus aria-hidden="true" />
            New idea
          </Button>
        }
      />
      <FactoryPlaceholder />
    </>
  );
}
