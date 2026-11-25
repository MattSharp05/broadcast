import "server-only";
import {
  FACTORY_TOKEN_TTL_MS,
  generateFactoryToken,
  hashFactoryToken,
} from "@/lib/auth/factory-tokens";
import { fail, type Db } from "@/lib/db/factory";
import { workspaceKindOf } from "@/lib/db/workspaces";

/** Mints a factory token for one production (only its hash is stored). */
export async function mintFactoryToken(
  ctx: { db: Db; workspaceId: string },
  productionId: string,
): Promise<string> {
  const token = generateFactoryToken(workspaceKindOf(ctx.workspaceId));
  const { error } = await ctx.db.from("factory_tokens").insert({
    workspace_id: ctx.workspaceId,
    production_id: productionId,
    token_hash: hashFactoryToken(token),
    // Real time, never the Sandbox clock: the session runs now.
    expires_at: new Date(Date.now() + FACTORY_TOKEN_TTL_MS).toISOString(),
  });
  if (error) fail("saving the session token", error);
  return token;
}

/** Mints a token for a routine's planner session (only its hash is stored). */
export async function mintRoutineToken(
  ctx: { db: Db; workspaceId: string },
  routineId: string,
): Promise<string> {
  const token = generateFactoryToken(workspaceKindOf(ctx.workspaceId));
  const { error } = await ctx.db.from("factory_tokens").insert({
    workspace_id: ctx.workspaceId,
    routine_id: routineId,
    token_hash: hashFactoryToken(token),
    expires_at: new Date(Date.now() + FACTORY_TOKEN_TTL_MS).toISOString(),
  });
  if (error) fail("saving the planner token", error);
  return token;
}
