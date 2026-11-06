import { CONNECT_RESULT_KEY, isConnectMessage, type ConnectMessage } from "../connect-message";
import { parseDraft, type WizardDraft } from "@/lib/domain/add-account";

/**
 * Where the Add account wizard keeps its draft between openings (sessionStorage: this tab only,
 * gone when the tab closes), one per workspace. Storage can be missing or blocked (private
 * windows): every access is guarded and the wizard then simply starts fresh.
 */

const key = (workspaceId: string) => `broadcast:add-account:${workspaceId}`;

export function loadDraft(
  workspaceId: string,
  brands: readonly { id: string }[],
): WizardDraft | null {
  try {
    return parseDraft(sessionStorage.getItem(key(workspaceId)), brands);
  } catch {
    return null;
  }
}

export function saveDraft(workspaceId: string, draft: WizardDraft): void {
  try {
    sessionStorage.setItem(key(workspaceId), JSON.stringify(draft));
  } catch {
    // No storage: the draft lives only while the wizard is open.
  }
}

export function clearDraft(workspaceId: string): void {
  try {
    sessionStorage.removeItem(key(workspaceId));
  } catch {
    // Nothing stored.
  }
}

/** True when a same-tab connect just came back with a result for the wizard. */
export function hasConnectResult(): boolean {
  try {
    return sessionStorage.getItem(CONNECT_RESULT_KEY) !== null;
  } catch {
    return false;
  }
}

/** The same-tab connect's result, removed as it's read. */
export function takeConnectResult(): ConnectMessage | null {
  try {
    const raw = sessionStorage.getItem(CONNECT_RESULT_KEY);
    sessionStorage.removeItem(CONNECT_RESULT_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return isConnectMessage(data) ? data : null;
  } catch {
    return null;
  }
}
