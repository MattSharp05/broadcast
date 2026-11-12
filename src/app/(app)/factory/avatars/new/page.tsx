import type { Metadata } from "next";
import { NewAvatarForm } from "@/features/factory/NewAvatarForm";
import { PageHeader } from "@/components/PageHeader";
import { fail } from "@/lib/db/factory";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspace } from "@/lib/db/workspace";

export const metadata: Metadata = { title: "New avatar · Content Factory · Broadcast" };
export const dynamic = "force-dynamic";

export default async function NewAvatarPage() {
  const db = await createServerSupabase();
  const w = await currentWorkspace();
  const [accounts, avatars] = await Promise.all([
    db.from("social_accounts").select("id, handle").eq("workspace_id", w.id).order("created_at"),
    db.from("avatars").select("account_id").eq("workspace_id", w.id),
  ]);
  if (accounts.error) fail("reading the accounts", accounts.error);
  const taken = new Set((avatars.data ?? []).map((a) => a.account_id));
  return (
    <>
      <PageHeader title="New avatar" />
      <NewAvatarForm accounts={accounts.data.filter((a) => !taken.has(a.id))} />
    </>
  );
}
