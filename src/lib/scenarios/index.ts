import { canvasBusy } from "./canvas-busy";
import { connectMissingPermission } from "./connect-missing-permission";
import { empty } from "./empty";
import { noAccounts } from "./no-accounts";
import { publishDueNow } from "./publish-due-now";
import { publishContainerError, publishQuotaExhausted } from "./publish-failures";
import { statsDue } from "./stats-due";
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
  statsDue,
];

export function getScenario(name: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
