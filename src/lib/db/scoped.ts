import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

type Tables = Database["public"]["Tables"];

/** Tables that carry a workspace_id (every data table). */
export type WorkspaceTable = {
  [K in keyof Tables]: Tables[K]["Row"] extends { workspace_id: string } ? K : never;
}[keyof Tables];

/**
 * Queries limited to one workspace (CLAUDE.md → Conventions: every query is scoped by
 * workspace_id). `scoped(db, workspaceId).select("posts", "id, status")` reads only that workspace's posts.
 */
export function scoped(db: SupabaseClient<Database>, workspaceId: string) {
  if (!workspaceId) throw new Error("A workspace id is required.");
  return {
    workspaceId,
    /** `select … where workspace_id = <id>` on a workspace table. */
    select<T extends WorkspaceTable>(table: T, columns = "*", options?: { count?: "exact" }) {
      return db
        .from(table)
        .select(columns, { count: options?.count })
        .eq("workspace_id" as never, workspaceId);
    },
    /** Number of the workspace's rows in a table. */
    async count(table: WorkspaceTable): Promise<number> {
      const res = await db
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("workspace_id" as never, workspaceId);
      if (res.error) throw new Error(`Counting ${table} failed: ${res.error.message}`);
      return res.count ?? 0;
    },
  };
}
