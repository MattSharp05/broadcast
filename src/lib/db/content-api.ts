import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRef } from "@/lib/domain/content-api";
import type { Database } from "./types";

type Db = SupabaseClient<Database>;

/**
 * The content API's database side (BC-17). Service-role client only; every query is pinned to the
 * API key's workspace. Uploads handed out to API clients live in `content_uploads`
 * (0007_api_keys.sql): the client knows an upload by its id; the storage path never leaves the
 * server.
 */

/** Storage's signed upload URLs last two hours (a fixed lifetime). */
export const UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what} failed: ${error.message}`);
}

/** Upload URLs a key asked for since `since`. */
export async function uploadsSince(admin: Db, keyId: string, since: Date): Promise<number> {
  const { count, error } = await admin
    .from("content_uploads")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", keyId)
    .gte("created_at", since.toISOString());
  if (error) fail("Counting uploads", error);
  return count ?? 0;
}

export interface NewUpload {
  id: string;
  workspaceId: string;
  keyId: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  expiresAt: Date;
}

export async function recordUpload(admin: Db, upload: NewUpload): Promise<void> {
  const { error } = await admin.from("content_uploads").insert({
    id: upload.id,
    workspace_id: upload.workspaceId,
    api_key_id: upload.keyId,
    storage_path: upload.storagePath,
    file_name: upload.fileName,
    content_type: upload.contentType,
    expires_at: upload.expiresAt.toISOString(),
  });
  if (error) fail("Saving the upload", error);
}

export async function forgetUpload(admin: Db, workspaceId: string, id: string): Promise<void> {
  const { error } = await admin
    .from("content_uploads")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) console.error(`Removing the upload record failed: ${error.message}`);
}

export interface ClaimedUpload {
  id: string;
  storagePath: string;
  fileName: string;
  contentType: string;
}

export type ClaimResult =
  { ok: true; upload: ClaimedUpload } | { ok: false; reason: "not_found" | "used" | "expired" };

/**
 * Takes an upload for one POST /api/content: sets `used_at` only if nobody has, so the same
 * upload can't be queued twice, even by two requests at once. Real time, never the Sandbox clock.
 */
export async function claimUpload(
  admin: Db,
  workspaceId: string,
  id: string,
  realNow: Date = new Date(),
): Promise<ClaimResult> {
  const claimed = await admin
    .from("content_uploads")
    .update({ used_at: realNow.toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("used_at", null)
    .gt("expires_at", realNow.toISOString())
    .select("id, storage_path, file_name, content_type")
    .maybeSingle();
  if (claimed.error) fail("Taking the upload", claimed.error);
  if (claimed.data) {
    const d = claimed.data;
    return {
      ok: true,
      upload: {
        id: d.id,
        storagePath: d.storage_path,
        fileName: d.file_name,
        contentType: d.content_type,
      },
    };
  }
  const row = await admin
    .from("content_uploads")
    .select("used_at")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (row.error) fail("Reading the upload", row.error);
  if (!row.data) return { ok: false, reason: "not_found" };
  return { ok: false, reason: row.data.used_at ? "used" : "expired" };
}

/** Gives a claimed upload back (the request failed for a reason the client can fix and retry). */
export async function releaseUpload(admin: Db, workspaceId: string, id: string): Promise<void> {
  const { error } = await admin
    .from("content_uploads")
    .update({ used_at: null })
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) console.error(`Releasing the upload failed: ${error.message}`);
}

export type ResolvedAccounts =
  | { ok: true; accountIds: string[] }
  /** `elsewhere`: refs that name an account of the other workspace (a Sandbox key can't post to Live). */
  | { ok: false; missing: AccountRef[]; elsewhere: AccountRef[] };

/** Turns handles and ids into the workspace's account ids, in the order given, without repeats. */
export async function resolveAccounts(
  admin: Db,
  workspaceId: string,
  refs: readonly AccountRef[],
): Promise<ResolvedAccounts> {
  const ids = [...new Set(refs.flatMap((r) => (r.kind === "id" ? [r.id] : [])))];
  const handles = [...new Set(refs.flatMap((r) => (r.kind === "handle" ? [r.handle] : [])))];
  const lookup = async (inWorkspace: boolean) => {
    const out: { id: string; handle: string }[] = [];
    for (const [column, values] of [
      ["id", ids],
      ["handle", handles],
    ] as const) {
      if (values.length === 0) continue;
      const base = admin.from("social_accounts").select("id, handle").in(column, values);
      const res = await (inWorkspace
        ? base.eq("workspace_id", workspaceId)
        : base.neq("workspace_id", workspaceId));
      if (res.error) fail("Reading the accounts", res.error);
      out.push(...res.data);
    }
    return out;
  };
  const matches = (ref: AccountRef, a: { id: string; handle: string }) =>
    ref.kind === "id" ? a.id === ref.id : a.handle.toLowerCase() === ref.handle;

  const found = await lookup(true);
  const accountIds: string[] = [];
  const missing: AccountRef[] = [];
  for (const ref of refs) {
    const account = found.find((a) => matches(ref, a));
    if (!account) missing.push(ref);
    else if (!accountIds.includes(account.id)) accountIds.push(account.id);
  }
  if (missing.length === 0) return { ok: true, accountIds };
  const other = await lookup(false);
  const elsewhere = missing.filter((ref) => other.some((a) => matches(ref, a)));
  return { ok: false, missing, elsewhere };
}
