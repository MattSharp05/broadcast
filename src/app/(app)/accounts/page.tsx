import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Accounts · Broadcast",
};

export default function AccountsPage() {
  return (
    <PageHeader
      title="Accounts"
      stats={[
        { value: 0, label: "accounts" },
        { value: 0, label: "ready to publish" },
        { value: 0, label: "need attention" },
      ]}
      actions={
        <Button variant="primary">
          <Plus aria-hidden="true" />
          Add account
        </Button>
      }
    />
  );
}
