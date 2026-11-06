import type { ReactNode } from "react";
import { AppRail } from "@/components/AppRail";
import { SandboxMarker } from "@/components/SandboxMarker";
import { readLastTick } from "@/lib/db/scheduler";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspaceKind, loadWorkspace } from "@/lib/db/workspace";
import { schedulerLine } from "@/lib/domain/scheduler-status";
import { switchWorkspace } from "./actions";
import styles from "./layout.module.css";

/** The app shell: navy rail + work area. Every tab renders its PageHeader inside main. */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const workspace = await currentWorkspaceKind();
  const db = await createServerSupabase();
  const [lastTick, settings] = await Promise.all([
    readLastTick(db),
    loadWorkspace(db, workspace).catch(() => null),
  ]);
  // Real time: the scheduler never runs on the Sandbox's frozen clock.
  const scheduler = schedulerLine(lastTick, new Date(), settings?.timezone ?? null);
  return (
    <div className={styles.app}>
      <AppRail workspace={workspace} onSwitchWorkspace={switchWorkspace} scheduler={scheduler} />
      <main className={styles.main}>
        {workspace === "sandbox" ? <SandboxMarker onSwitchWorkspace={switchWorkspace} /> : null}
        {children}
      </main>
    </div>
  );
}
