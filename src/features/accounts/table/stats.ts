import type { PageStat } from "@/components/PageHeader";
import type { AccountStats } from "@/lib/domain/accounts";

/** The Accounts top bar: "5 accounts | 4 ready to publish | 1 need attention". */
export function accountsStats(stats: AccountStats): PageStat[] {
  return [
    { value: stats.accounts, label: stats.accounts === 1 ? "account" : "accounts" },
    { value: stats.ready, label: "ready to publish" },
    { value: stats.attention, label: stats.attention === 1 ? "needs attention" : "need attention" },
  ];
}
