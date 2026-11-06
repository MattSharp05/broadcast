import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * When the scheduler last ticked (scheduler_status, written by every real tick), as the signed-in
 * user sees it. Null when it never ran or the row can't be read.
 */
export async function readLastTick(db: SupabaseClient<Database>): Promise<Date | null> {
  const { data, error } = await db
    .from("scheduler_status")
    .select("last_tick_at")
    .eq("id", true)
    .maybeSingle();
  if (error) {
    console.error(`Reading the scheduler status failed: ${error.message}`);
    return null;
  }
  return data?.last_tick_at ? new Date(data.last_tick_at) : null;
}
