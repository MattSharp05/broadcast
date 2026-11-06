import type { ReactNode } from "react";
import { AppRail } from "@/components/AppRail";
import { SandboxMarker } from "@/components/SandboxMarker";
import { currentWorkspaceKind } from "@/lib/db/workspace";
import { switchWorkspace } from "./actions";
import styles from "./layout.module.css";

/** The app shell: navy rail + work area. Every tab renders its PageHeader inside main. */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const workspace = await currentWorkspaceKind();
  return (
    <div className={styles.app}>
      <AppRail workspace={workspace} onSwitchWorkspace={switchWorkspace} />
      <main className={styles.main}>
        {workspace === "sandbox" ? <SandboxMarker onSwitchWorkspace={switchWorkspace} /> : null}
        {children}
      </main>
    </div>
  );
}
