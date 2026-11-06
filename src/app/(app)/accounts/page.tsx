import type { Metadata } from "next";
import { AccountsView } from "@/features/accounts/table/AccountsView";
import { nowFor } from "@/lib/clock";
import { loadAccounts } from "@/lib/db/accounts";
import { loadAccountDetails } from "@/lib/db/details";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspace } from "@/lib/db/workspace";
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
  const workspace = await currentWorkspace();
  const now = nowFor(workspace);
  const timezone = workspace.timezone ?? "UTC";
  const [data, accountDetails] = await Promise.all([
    loadAccounts(db, workspace.id),
    loadAccountDetails(db, workspace.id, now, timezone),
  ]);
  return (
    <AccountsView
      accounts={data.accounts}
      brands={data.brands}
      workspace={{ id: workspace.id, kind: workspace.kind }}
      actions={{
        updateAccountTags,
        updateAccountDescription,
        addBrand,
        updateBrandName,
        readConnectedAccount,
        finishAddAccount,
      }}
      details={{ accounts: accountDetails, now: now.toISOString(), timezone }}
    />
  );
}
