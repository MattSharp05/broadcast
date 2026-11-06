"use server";

import { revalidatePath } from "next/cache";
import { nowFor } from "@/lib/clock";
import { hasTokenKey, tokenKeyFromEnv } from "@/lib/crypto/tokens";
import { loadConnectedAccount, saveAccountSetup } from "@/lib/db/add-account";
import { createAdminSupabase } from "@/lib/db/admin";
import { loadAccessToken } from "@/lib/db/credentials";
import {
  DuplicateBrandError,
  NotFoundError,
  createBrand,
  renameBrand,
  saveAccountDescription,
  saveAccountTags,
} from "@/lib/db/accounts";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspaceKind, loadWorkspace } from "@/lib/db/workspace";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { cleanBrandName, cleanDescription } from "@/lib/domain/accounts";
import { cleanSlots, cleanVaultUrl, type ConnectedAccount } from "@/lib/domain/add-account";
import { cleanTags } from "@/lib/domain/tags";
import { providerFor } from "@/lib/providers";
import { createDbFakeStore } from "@/lib/providers/fake-store";
import { instagramConfigFromEnv } from "@/lib/providers/instagram";
import type { ActionResult } from "@/features/accounts/table/actions";

/**
 * The Accounts tab's inline edits. Each acts as the signed-in user (RLS) on the workspace the
 * dashboard shows. Tag and brand edits refresh both tabs (tags feed the Workflow's Tag filter);
 * description autosaves refresh nothing (the textarea already shows the text, and a refresh on
 * every pause in typing would re-read the whole table).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run<T>(
  work: (db: Awaited<ReturnType<typeof createServerSupabase>>, workspaceId: string) => Promise<T>,
  options: { revalidate: boolean } = { revalidate: true },
): Promise<ActionResult<T>> {
  try {
    const db = await createServerSupabase();
    const workspaceId = WORKSPACE_IDS[await currentWorkspaceKind()];
    const value = await work(db, workspaceId);
    if (options.revalidate) {
      revalidatePath("/accounts");
      revalidatePath("/workflow");
    }
    return { ok: true, value };
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof DuplicateBrandError) {
      return { ok: false, error: e.message };
    }
    console.error(e);
    return { ok: false, error: "Couldn't save. Check your connection and try again." };
  }
}

function invalid(error: string): ActionResult<never> {
  return { ok: false, error };
}

export async function updateAccountTags(
  accountId: string,
  tags: string[],
): Promise<ActionResult<string[]>> {
  if (!UUID.test(accountId) || !Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
    return invalid("That account can't be changed.");
  }
  const clean = cleanTags(tags);
  return run(async (db, ws) => {
    await saveAccountTags(db, ws, accountId, clean);
    return clean;
  });
}

export async function updateAccountDescription(
  accountId: string,
  description: string,
): Promise<ActionResult<string>> {
  if (!UUID.test(accountId) || typeof description !== "string") {
    return invalid("That account can't be changed.");
  }
  const clean = cleanDescription(description);
  return run(
    async (db, ws) => {
      await saveAccountDescription(db, ws, accountId, clean);
      return clean;
    },
    { revalidate: false },
  );
}

export async function addBrand(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  const clean = typeof name === "string" ? cleanBrandName(name) : null;
  if (!clean) return invalid("Give the brand a name.");
  return run((db, ws) => createBrand(db, ws, clean));
}

export async function updateBrandName(
  brandId: string,
  name: string,
): Promise<ActionResult<string>> {
  const clean = typeof name === "string" ? cleanBrandName(name) : null;
  if (!UUID.test(brandId)) return invalid("That brand can't be changed.");
  if (!clean) return invalid("Give the brand a name.");
  return run(async (db, ws) => {
    await renameBrand(db, ws, brandId, clean);
    return clean;
  });
}

/**
 * The Add account wizard's Connect step: the account the connect popup reported, read back from
 * the database (the popup's message is only a hint: /connect/done can be opened with any id).
 */
export async function readConnectedAccount(
  accountId: string,
): Promise<ActionResult<ConnectedAccount>> {
  if (!UUID.test(accountId)) return invalid("That account isn't in this workspace.");
  return run(
    async (db, ws) => {
      const workspace = await loadWorkspace(db, await currentWorkspaceKind());
      const admin = createAdminSupabase();
      return loadConnectedAccount(db, ws, accountId, {
        admin,
        quota: async (account) => {
          const provider = providerFor(account, {
            fakeStore: createDbFakeStore(admin),
            now: () => nowFor(workspace),
            instagram: instagramConfigFromEnv(),
          });
          let accessToken = "";
          if (account.platform === "instagram") {
            if (!hasTokenKey()) return null;
            const token = await loadAccessToken(admin, ws, account.id, tokenKeyFromEnv());
            if (!token) return null;
            accessToken = token;
          }
          return {
            provider,
            account: { accountId: account.id, platformUserId: account.platformUserId, accessToken },
          };
        },
      });
    },
    { revalidate: false },
  );
}

export interface AddAccountSetup {
  tags: string[];
  description: string;
  slots: string[];
  vaultUrl: string;
}

/** The wizard's Add account: saves tags, description, slots and the vault link. */
export async function finishAddAccount(
  accountId: string,
  setup: AddAccountSetup,
): Promise<ActionResult<{ handle: string; slots: number }>> {
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
  if (
    !UUID.test(accountId) ||
    typeof setup !== "object" ||
    !strings(setup.tags) ||
    !strings(setup.slots) ||
    typeof setup.description !== "string" ||
    typeof setup.vaultUrl !== "string"
  ) {
    return invalid("That account can't be changed.");
  }
  const slots = cleanSlots(setup.slots);
  if (slots.length === 0) return invalid("Add at least one posting slot.");
  const vault = cleanVaultUrl(setup.vaultUrl);
  if (!vault.valid) return invalid("The vault link must be an https:// link.");
  return run(async (db, ws) => {
    const saved = await saveAccountSetup(db, ws, accountId, {
      tags: cleanTags(setup.tags),
      description: cleanDescription(setup.description),
      slots,
      vaultUrl: vault.url,
    });
    return { handle: saved.handle, slots: slots.length };
  });
}
