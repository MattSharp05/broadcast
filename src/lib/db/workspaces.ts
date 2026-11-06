/** The two workspaces created by the first migration (ADR 0003). Fixed ids. */
export const WORKSPACE_IDS = {
  live: "00000000-0000-4000-8000-000000000001",
  sandbox: "00000000-0000-4000-8000-000000000002",
} as const;

export type WorkspaceKind = keyof typeof WORKSPACE_IDS;

export const WORKSPACE_NAMES: Record<WorkspaceKind, string> = { live: "Live", sandbox: "Sandbox" };

/** Cookie holding the workspace the dashboard shows (`live` | `sandbox`). */
export const WORKSPACE_COOKIE = "bc-workspace";

/** The workspace named by the cookie; anything else (or nothing) means Live. */
export function parseWorkspaceKind(value: string | null | undefined): WorkspaceKind {
  return value === "sandbox" ? "sandbox" : "live";
}

/** Cookie options: a year, whole site, not readable by scripts. */
export const WORKSPACE_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 365,
} as const;

/** The kind of a workspace id (the two fixed ids); anything else throws. */
export function workspaceKindOf(id: string): WorkspaceKind {
  if (id === WORKSPACE_IDS.live) return "live";
  if (id === WORKSPACE_IDS.sandbox) return "sandbox";
  throw new Error(`Unknown workspace id ${id}.`);
}
