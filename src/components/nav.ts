import type { LucideIcon } from "lucide-react";
import { LayoutGrid, Lightbulb, Users } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Small marker after the label, e.g. "v1" for tabs that are placeholders until then. */
  marker?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/workflow", label: "Workflow", icon: LayoutGrid },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/factory", label: "Content Factory", icon: Lightbulb, marker: "v1" },
];

/** A tab is active on its own route and on any route below it. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
