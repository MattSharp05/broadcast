import { addContent } from "./add-content";
import { canvasBusy } from "./canvas-busy";
import { connectMissingPermission } from "./connect-missing-permission";
import { empty } from "./empty";
import { FACTORY_SCENARIOS } from "./factory";
import { noAccounts } from "./no-accounts";
import { postFailed } from "./post-failed";
import { postsTable } from "./posts-table";
import { publishDueNow } from "./publish-due-now";
import { publishContainerError, publishQuotaExhausted } from "./publish-failures";
import { ROUTINE_SCENARIOS } from "./routines";
import { statsDue } from "./stats-due";
import { STUDIO_SCENARIOS } from "./studio";
import { tokenExpiring } from "./token-expiring";
import type { Scenario } from "./types";

export type { Scenario, SandboxSeed } from "./types";

/** Every scenario, in the order /dev lists them. Add new ones here (Scenario rule). */
export const SCENARIOS: readonly Scenario[] = [
  canvasBusy,
  empty,
  connectMissingPermission,
  publishDueNow,
  noAccounts,
  publishQuotaExhausted,
  publishContainerError,
  addContent,
  statsDue,
  tokenExpiring,
  postFailed,
  ...FACTORY_SCENARIOS,
  ...STUDIO_SCENARIOS,
  ...ROUTINE_SCENARIOS,
  postsTable,
];

export function getScenario(name: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
