"use server";

import { revalidatePath } from "next/cache";
import { TagError, applyPostTag } from "@/lib/db/posts-table";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspaceKind } from "@/lib/db/workspace";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import type { ActionResult } from "@/features/accounts/table/actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_POSTS = 500;

/**
 * The Posts tab's bulk tag edit: adds or removes one tag on the selected posts, as the signed-in
 * user (RLS) on the workspace the dashboard shows. Returns each post's tags afterwards.
 */
export async function tagPosts(
  postIds: string[],
  tag: string,
  op: unknown,
): Promise<ActionResult<Record<string, string[]>>> {
  if (
    !Array.isArray(postIds) ||
    postIds.length === 0 ||
    postIds.length > MAX_POSTS ||
    postIds.some((id) => typeof id !== "string" || !UUID.test(id)) ||
    typeof tag !== "string" ||
    (op !== "add" && op !== "remove")
  ) {
    return { ok: false, error: "Pick one or more posts and a tag." };
  }
  try {
    const db = await createServerSupabase();
    const workspaceId = WORKSPACE_IDS[await currentWorkspaceKind()];
    const value = await applyPostTag(db, workspaceId, postIds, tag, op);
    revalidatePath("/posts");
    return { ok: true, value };
  } catch (e) {
    if (e instanceof TagError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Couldn't save the tag. Check your connection and try again." };
  }
}
