import type { Metadata } from "next";
import { AccountsView } from "@/features/accounts/table/AccountsView";
import { loadAccounts } from "@/lib/db/accounts";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspaceKind } from "@/lib/db/workspace";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import {
  addBrand,
  finishAddAccount,
  readConnectedAccount,
  updateAccountDescription,
  updateAccountTags,
  updateBrandName,
} from "./actions";

export const metadata: Metadata = {
  title: "Accounts · Broadcast",
};

/** The Accounts tab: every account of the workspace, grouped by brand, with inline edits. */
export default async function AccountsPage() {
  const db = await createServerSupabase();
  const kind = await currentWorkspaceKind();
  const workspaceId = WORKSPACE_IDS[kind];
  const data = await loadAccounts(db, workspaceId);
  return (
    <AccountsView
      accounts={data.accounts}
      brands={data.brands}
      workspace={{ id: workspaceId, kind }}
      actions={{
        updateAccountTags,
        updateAccountDescription,
        addBrand,
        updateBrandName,
        readConnectedAccount,
        finishAddAccount,
      }}
    />
  );
}
