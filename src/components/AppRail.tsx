"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./AppRail.module.css";
import { NAV_ITEMS, isActivePath } from "./nav";
import { StatusDot } from "./StatusDot";

/** The navy navigation rail. Below 760px it becomes a bottom tab bar. */
export function AppRail() {
  const pathname = usePathname();

  return (
    <nav className={styles.rail} aria-label="Main">
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          <Send />
        </span>
        Broadcast
      </div>

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
      </div>
    </nav>
  );
}
