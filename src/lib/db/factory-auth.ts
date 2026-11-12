import "server-only";
import { sameHash } from "@/lib/auth/api-keys";
import { bearerToken } from "@/lib/auth/api-keys";
import { factoryTokenKind, hashFactoryToken, isFactoryTokenShape } from "@/lib/auth/factory-tokens";
import type { Db } from "./factory";
import { WORKSPACE_IDS, type WorkspaceKind } from "./workspaces";

/** A session's factory token, checked (docs/factory-api.md). Service-role client. */
export interface FactoryAuth {
  tokenId: string;
  workspaceId: string;
  kind: WorkspaceKind;
  productionId: string;
}

export async function authenticateFactoryToken(
  admin: Db,
  header: string | null,
  now: Date = new Date(),
): Promise<FactoryAuth | null> {
  const token = bearerToken(header);
  if (!token || !isFactoryTokenShape(token)) return null;
  const kind = factoryTokenKind(token);
  if (!kind) return null;
  const hash = hashFactoryToken(token);
  const { data, error } = await admin
    .from("factory_tokens")
    .select("id, workspace_id, production_id, token_hash, expires_at, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) return null;
  if (!sameHash(data.token_hash, hash)) return null;
  if (data.revoked_at || new Date(data.expires_at) <= now) return null;
  if (data.workspace_id !== WORKSPACE_IDS[kind]) return null;
  await admin.from("factory_tokens").update({ last_used_at: now.toISOString() }).eq("id", data.id);
  return {
    tokenId: data.id,
    workspaceId: data.workspace_id,
    kind,
    productionId: data.production_id,
  };
}
