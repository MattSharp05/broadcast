/** The two workspaces created by the first migration (ADR 0003). Fixed ids. */
export const WORKSPACE_IDS = {
  live: "00000000-0000-4000-8000-000000000001",
  sandbox: "00000000-0000-4000-8000-000000000002",
} as const;

export type WorkspaceKind = keyof typeof WORKSPACE_IDS;
