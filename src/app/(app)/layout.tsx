import type { ReactNode } from "react";
import { AppRail } from "@/components/AppRail";
import { SandboxMarker } from "@/components/SandboxMarker";
import { countNeedsAttention } from "@/lib/db/health";
import { readLastTick } from "@/lib/db/scheduler";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspaceKind, loadWorkspace } from "@/lib/db/workspace";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { schedulerLine } from "@/lib/domain/scheduler-status";
import { switchWorkspace } from "./actions";
import styles from "./layout.module.css";

/** The app shell: navy rail + work area. Every tab renders its PageHeader inside main. */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const workspace = await currentWorkspaceKind();
  const db = await createServerSupabase();
  const [lastTick, settings, attention] = await Promise.all([
    readLastTick(db),
    loadWorkspace(db, workspace).catch(() => null),
    countNeedsAttention(db, WORKSPACE_IDS[workspace]).catch(() => 0),
  ]);
  // Real time: the scheduler never runs on the Sandbox's frozen clock.
  const scheduler = schedulerLine(lastTick, new Date(), settings?.timezone ?? null);
  return (
    <div className={styles.app}>
      <AppRail
        workspace={workspace}
        onSwitchWorkspace={switchWorkspace}
        scheduler={scheduler}
        attention={attention}
      />
      <main className={styles.main}>
        {workspace === "sandbox" ? <SandboxMarker onSwitchWorkspace={switchWorkspace} /> : null}
        {children}
      </main>
    </div>
  );
}
