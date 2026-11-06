import type { SupabaseClient } from "@supabase/supabase-js";
import { permissionChecks, type ConnectedAccount } from "@/lib/domain/add-account";
import type { ProviderAccount, SocialProvider } from "@/lib/providers/types";
import { NotFoundError } from "./accounts";
import type { Database } from "./types";

type Db = SupabaseClient<Database>;

/**
 * The Add account wizard's server side (BC-13). The wizard learns that connecting finished from a
 * browser message, but everything it shows is read here, scoped by workspace_id.
 */

export interface ConnectedAccountDeps {
  /** Service-role client: granted scopes live in oauth_credentials (no browser access). */
  admin: Db;
  /** The account's provider and its token, for the quota check; null skips it. */
  quota:
    | ((account: {
        id: string;
        platform: "instagram" | "fake";
        platformUserId: string | null;
      }) => Promise<{ provider: SocialProvider; account: ProviderAccount } | null>)
    | null;
}

/**
 * The connected account as the wizard's Connect step shows it: who, status, each permission
 * Granted/Missing (from the stored scopes, never the token) and the daily posts used. Throws
 * NotFoundError when the account isn't in the workspace (a done page opened by hand with any id).
 */
export async function loadConnectedAccount(
  db: Db,
  workspaceId: string,
  accountId: string,
  deps: ConnectedAccountDeps,
): Promise<ConnectedAccount> {
  const { data, error } = await db
    .from("social_accounts")
    .select(
      "id, handle, platform, platform_user_id, brand_id, status, status_reason, followers, tags, description, slots",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`Reading the account failed: ${error.message}`);
  if (!data) throw new NotFoundError("That account isn't in this workspace.");

  const creds = await deps.admin
    .from("oauth_credentials")
    .select("scopes")
    .eq("workspace_id", workspaceId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (creds.error) throw new Error(`Reading the permissions failed: ${creds.error.message}`);

  let quota: ConnectedAccount["quota"] = null;
  if (creds.data && deps.quota) {
    try {
      const target = await deps.quota({
        id: data.id,
        platform: data.platform,
        platformUserId: data.platform_user_id,
      });
      if (target) {
        const q = await target.provider.getPublishingQuota(target.account);
        quota = { used: q.used, limit: q.limit };
      }
    } catch (e) {
      // The quota is shown for information only; the scheduler checks it again before posting.
      console.error("Reading the publishing quota failed:", e instanceof Error ? e.message : e);
    }
  }

  return {
    id: data.id,
    handle: data.handle,
    platform: data.platform,
    brandId: data.brand_id,
    status: data.status,
    statusReason: data.status_reason,
    followers: data.followers,
    permissions: permissionChecks(data.platform, creds.data?.scopes ?? []),
    quota,
    tags: data.tags,
    description: data.description,
    slots: data.slots,
  };
}

export interface AccountSetup {
  tags: string[];
  description: string;
  slots: string[];
  vaultUrl: string | null;
}

/** Saves the wizard's last step (already cleaned). Returns the account's handle. */
export async function saveAccountSetup(
  db: Db,
  workspaceId: string,
  accountId: string,
  setup: AccountSetup,
): Promise<{ handle: string }> {
  const res = await db
    .from("social_accounts")
    .update({
      tags: setup.tags,
      description: setup.description,
      slots: setup.slots,
      vault_url: setup.vaultUrl,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", accountId)
    .select("handle");
  if (res.error) throw new Error(`Saving the account failed: ${res.error.message}`);
  const row = res.data[0];
  if (!row) throw new NotFoundError("That account no longer exists.");
  return { handle: row.handle };
}
