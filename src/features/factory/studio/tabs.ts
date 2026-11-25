import type { ComponentType } from "react";
import type { FactoryOptions, ProductionPage } from "@/lib/db/factory-page";
import type { StudioData } from "@/lib/db/studio-page";
import type { Notify } from "../ProductionView";
import type { FactoryResult } from "@/app/(app)/factory/actions";
import { VersionsTab } from "./VersionsTab";

/**
 * The tabs of a video page (BC-37). A later ticket adds its tab with one line here; `Panel` is
 * left out for Make, whose sections ProductionView renders itself.
 */

export interface StudioTabProps {
  video: ProductionPage;
  options: FactoryOptions;
  studio: StudioData;
  run: <T>(
    fn: () => Promise<FactoryResult<T>>,
    success?: string | ((v: T) => string | null),
  ) => void;
  notify: Notify;
  pending: boolean;
}

export interface StudioTab {
  key: string;
  label: string;
  Panel?: ComponentType<StudioTabProps>;
}

export const STUDIO_TABS: readonly StudioTab[] = [
  { key: "make", label: "Make" },
  { key: "versions", label: "Versions", Panel: VersionsTab },
  // Board (BC-40) and Ready to post (BC-39) go here.
];

/** `?tab=` when it names a tab, else Versions once a version exists, else Make. */
export function initialTab(requested: string | null | undefined, hasVersions: boolean): string {
  if (requested && STUDIO_TABS.some((t) => t.key === requested)) return requested;
  return hasVersions ? "versions" : "make";
}
