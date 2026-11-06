"use server";

import { revalidatePath } from "next/cache";
import {
  NotFoundError,
  createBrand,
  renameBrand,
  saveAccountDescription,
  saveAccountTags,
} from "@/lib/db/accounts";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspaceKind } from "@/lib/db/workspace";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { cleanBrandName, cleanDescription } from "@/lib/domain/accounts";
import { cleanTags } from "@/lib/domain/tags";
import type { ActionResult } from "@/features/accounts/table/actions";

/**
 * The Accounts tab's inline edits. Each acts as the signed-in user (RLS) on the workspace the
 * dashboard shows, and refreshes both tabs (tags feed the Workflow's Tag filter).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run<T>(
  work: (db: Awaited<ReturnType<typeof createServerSupabase>>, workspaceId: string) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const db = await createServerSupabase();
    const workspaceId = WORKSPACE_IDS[await currentWorkspaceKind()];
    const value = await work(db, workspaceId);
    revalidatePath("/accounts");
    revalidatePath("/workflow");
    return { ok: true, value };
  } catch (e) {
    if (e instanceof NotFoundError) return { ok: false, error: e.message };
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
  return run(async (db, ws) => {
    await saveAccountDescription(db, ws, accountId, clean);
    return clean;
  });
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
