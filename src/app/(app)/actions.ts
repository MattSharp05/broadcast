"use server";

import { revalidatePath } from "next/cache";
import { setWorkspaceKind } from "@/lib/db/workspace";
import { parseWorkspaceKind } from "@/lib/db/workspaces";

/** The rail's workspace switcher: Live or Sandbox (kept in a cookie). */
export async function switchWorkspace(formData: FormData): Promise<void> {
  const value = formData.get("workspace");
  await setWorkspaceKind(parseWorkspaceKind(typeof value === "string" ? value : null));
  revalidatePath("/", "layout");
}
