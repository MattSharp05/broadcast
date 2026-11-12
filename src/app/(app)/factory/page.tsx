import { Settings, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { FactoryList } from "@/features/factory/FactoryList";
import { NewVideoButton } from "@/features/factory/NewVideoButton";
import { loadFactoryList } from "@/lib/db/factory-page";
import { usd } from "@/lib/domain/factory/budget";

export const metadata: Metadata = {
  title: "Content Factory · Broadcast",
};

export const dynamic = "force-dynamic";

/** The Content Factory: every video being made, whatever its kind (ADR 0007). */
export default async function FactoryPage() {
  const data = await loadFactoryList();
  const inProduction = data.videos.filter((v) => ["running", "waiting"].includes(v.status)).length;
  const ready = data.videos.filter((v) => v.status === "ready").length;
  return (
    <>
      <PageHeader
        title="Content Factory"
        stats={[
          { value: inProduction, label: "in production" },
          { value: ready, label: "ready to schedule" },
          {
            value: `${usd(data.monthUsd)} of ${usd(data.caps.monthlyUsd)}`,
            label: "Spent this month",
            labelFirst: true,
          },
        ]}
        actions={
          <>
            <ButtonLink href="/factory/avatars" variant="ghost">
              <UserRound aria-hidden="true" />
              Avatars
            </ButtonLink>
            <ButtonLink href="/factory/settings" variant="ghost">
              <Settings aria-hidden="true" />
              Settings
            </ButtonLink>
            <NewVideoButton />
          </>
        }
      />
      <FactoryList videos={data.videos} />
    </>
  );
}
