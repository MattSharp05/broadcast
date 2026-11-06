import type { BrandRef } from "@/lib/domain/accounts";
import type { ConnectedAccount } from "@/lib/domain/add-account";

export type ActionResult<T = null> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The server actions the table calls (src/app/(app)/accounts/actions.ts), passed in by the page
 * so the table stays free of server imports.
 */
export interface AccountsActions {
  updateAccountTags: (accountId: string, tags: string[]) => Promise<ActionResult<string[]>>;
  updateAccountDescription: (
    accountId: string,
    description: string,
  ) => Promise<ActionResult<string>>;
  addBrand: (name: string) => Promise<ActionResult<BrandRef>>;
  updateBrandName: (brandId: string, name: string) => Promise<ActionResult<string>>;
  /** Add account wizard: the account a connect reported, read back from the server. */
  readConnectedAccount: (accountId: string) => Promise<ActionResult<ConnectedAccount>>;
  /** Add account wizard: saves the posting setup. */
  finishAddAccount: (
    accountId: string,
    setup: { tags: string[]; description: string; slots: string[]; vaultUrl: string },
  ) => Promise<ActionResult<{ handle: string; slots: number }>>;
}
