import type { Metadata } from "next";
import { AccountsView } from "@/features/accounts/table/AccountsView";
import { nowFor } from "@/lib/clock";
import { loadAccounts } from "@/lib/db/accounts";
import { loadAccountDetails } from "@/lib/db/details";
import type { StatusFilter } from "@/lib/domain/accounts";
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
const STATUSES: readonly StatusFilter[] = ["ready", "needs_attention", "not_connected"];

/** `?status=needs_attention` (the rail's "accounts need attention" link) filters the table. */
function statusParam(value: string | string[] | undefined): StatusFilter {
  return STATUSES.find((s) => s === value) ?? "all";
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const status = statusParam((await searchParams).status);
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
      key={status}
      initialStatus={status}
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
