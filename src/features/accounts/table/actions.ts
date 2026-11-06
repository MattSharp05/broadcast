import type { BrandRef } from "@/lib/domain/accounts";

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
}
