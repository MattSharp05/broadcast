"use client";

import { LogOut, Send } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { WorkspaceKind } from "@/lib/db/workspaces";
import styles from "./AppRail.module.css";
import { NAV_ITEMS, isActivePath } from "./nav";
import { StatusDot } from "./StatusDot";

interface AppRailProps {
  /** The workspace being shown; the switcher marks it. */
  workspace?: WorkspaceKind;
  /** Server action that switches the workspace (form field `workspace`). */
  onSwitchWorkspace?: (formData: FormData) => void | Promise<void>;
}

const WORKSPACES: readonly { kind: WorkspaceKind; label: string }[] = [
  { kind: "live", label: "Live" },
  { kind: "sandbox", label: "Sandbox" },
];

/** The navy navigation rail. Below 760px it becomes a bottom tab bar. */
export function AppRail({ workspace = "live", onSwitchWorkspace }: AppRailProps) {
  const pathname = usePathname();

  return (
    <nav className={styles.rail} aria-label="Main">
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          <Send />
        </span>
        Broadcast
      </div>

      <form action={onSwitchWorkspace} className={styles.workspaces} aria-label="Workspace">
        {WORKSPACES.map(({ kind, label }) => (
          <button
            key={kind}
            type="submit"
            name="workspace"
            value={kind}
            className={styles.workspace}
            aria-pressed={workspace === kind}
          >
            {label}
          </button>
        ))}
      </form>

      {NAV_ITEMS.map(({ href, label, icon: Icon, marker }) => (
        <Link
          key={href}
          href={href}
          className={styles.item}
          aria-current={isActivePath(pathname, href) ? "page" : undefined}
        >
          <Icon aria-hidden="true" />
          <span className={styles.label}>{label}</span>
          {marker ? <span className={styles.marker}>{marker}</span> : null}
        </Link>
      ))}

      <div className={styles.foot}>
        {/* Placeholder until the scheduler exists (Epic 2). */}
        <div className={styles.sys}>
          <StatusDot tone="neutral" className={styles.sysDot} />
          <span>
            Scheduler not running yet
            <small>Added in a later ticket</small>
          </span>
        </div>
        <form action="/auth/sign-out" method="post">
          <button type="submit" className={styles.signOut}>
            <LogOut aria-hidden="true" />
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
