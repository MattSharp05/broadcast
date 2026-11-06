"use client";

import { LogOut, Send } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { WorkspaceKind } from "@/lib/db/workspaces";
import { attentionLine } from "@/lib/domain/health";
import type { SchedulerLine } from "@/lib/domain/scheduler-status";
import styles from "./AppRail.module.css";
import { NAV_ITEMS, isActivePath } from "./nav";
import { StatusDot } from "./StatusDot";

interface AppRailProps {
  /** The workspace being shown; the switcher marks it. */
  workspace?: WorkspaceKind;
  /** Server action that switches the workspace (form field `workspace`). */
  onSwitchWorkspace?: (formData: FormData) => void | Promise<void>;
  /** The scheduler's status line for the footer (src/lib/domain/scheduler-status.ts). */
  scheduler?: SchedulerLine;
  /** Accounts of this workspace that need attention (BC-19): an amber line linking to them. */
  attention?: number;
}

const WORKSPACES: readonly { kind: WorkspaceKind; label: string }[] = [
  { kind: "live", label: "Live" },
  { kind: "sandbox", label: "Sandbox" },
];

/** The navy navigation rail. Below 760px it becomes a bottom tab bar. */
export function AppRail({
  workspace = "live",
  onSwitchWorkspace,
  scheduler,
  attention = 0,
}: AppRailProps) {
  const pathname = usePathname();
  const attentionText = attentionLine(attention);

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
        {scheduler ? (
          <div className={styles.sys} data-testid="scheduler-status" data-tone={scheduler.tone}>
            <StatusDot tone={scheduler.tone} className={styles.sysDot} />
            <span>
              {scheduler.title}
              <small>{scheduler.detail}</small>
            </span>
          </div>
        ) : null}
        {attentionText ? (
          <Link
            href="/accounts?status=needs_attention"
            className={`${styles.sys} ${styles.sysLink}`}
            data-testid="attention-status"
            data-tone="warn"
          >
            <StatusDot tone="warn" className={styles.sysDot} />
            <span>{attentionText}</span>
          </Link>
        ) : null}
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
