import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "./server";
import type { Database } from "./types";
import {
  WORKSPACE_COOKIE,
  WORKSPACE_COOKIE_OPTIONS,
  WORKSPACE_IDS,
  WORKSPACE_NAMES,
  parseWorkspaceKind,
  type WorkspaceKind,
} from "./workspaces";

export interface Workspace {
  id: string;
  kind: WorkspaceKind;
  name: string;
  /** IANA timezone, or null until the browser sets it. */
  timezone: string | null;
  /** Sandbox only: the fixed clock (ISO), or null for real time. */
  clockOverride: string | null;
}

/** The workspace the dashboard is showing (cookie; Live by default). No database call. */
export async function currentWorkspaceKind(): Promise<WorkspaceKind> {
  return parseWorkspaceKind((await cookies()).get(WORKSPACE_COOKIE)?.value);
}

/** Switches the dashboard's workspace (route handlers and server actions only). */
export async function setWorkspaceKind(kind: WorkspaceKind): Promise<void> {
  (await cookies()).set(WORKSPACE_COOKIE, kind, WORKSPACE_COOKIE_OPTIONS);
}

/** The current workspace with its settings, read as the signed-in user. */
export async function currentWorkspace(): Promise<Workspace> {
  const kind = await currentWorkspaceKind();
  const db = await createServerSupabase();
  return loadWorkspace(db, kind);
}

export async function loadWorkspace(
  db: SupabaseClient<Database>,
  kind: WorkspaceKind,
): Promise<Workspace> {
  const id = WORKSPACE_IDS[kind];
  const { data, error } = await db
    .from("settings")
    .select("timezone, clock_override")
    .eq("workspace_id", id)
    .maybeSingle();
  if (error) throw new Error(`Reading the workspace settings failed: ${error.message}`);
  return {
    id,
    kind,
    name: WORKSPACE_NAMES[kind],
    timezone: data?.timezone ?? null,
    clockOverride: data?.clock_override ?? null,
  };
}
