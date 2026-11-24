/**
 * Versions (pure, ADR 0008): every render of a video is kept as a numbered version instead of
 * overwriting the last one. Storage is bounded by pruning: a posted (or chosen) version keeps its
 * full file and proxy, the newest draft keeps its full file, and the newest few others keep only
 * their 720p proxy. Everything else is cleared (the row stays; git_sha makes it reproducible).
 */

export type VersionMadeBy = "render" | "revise" | "import";

/** How many unposted versions keep their proxy (the newest ones). */
export const KEEP_PROXIES = 3;

/** The next number for a production's versions: 1 for the first, then max + 1. */
export function nextVersionNumber(existing: readonly { number: number }[]): number {
  return existing.reduce((max, v) => Math.max(max, v.number), 0) + 1;
}

export interface PrunableVersion {
  id: string;
  number: number;
  mediaId: string | null;
  proxyPath: string | null;
  /** A post uses this version's media. */
  posted: boolean;
  /** productions.media_id points at this version's media (the one chosen for posting). */
  chosen?: boolean;
}

export interface PruneAction {
  id: string;
  /** Delete the full file (media asset) and clear media_id. */
  media: boolean;
  /** Delete the proxy and clear proxy_path. */
  proxy: boolean;
}

/**
 * What to clear, oldest first. Kept whole: posted and chosen versions. Full file also kept: the
 * newest of the rest (it may still be chosen). Proxies also kept: the newest `keep` of the rest.
 * Only actions that clear something are returned.
 */
export function pruneSelection(
  versions: readonly PrunableVersion[],
  keep: number = KEEP_PROXIES,
): PruneAction[] {
  const newestFirst = [...versions].sort((a, b) => b.number - a.number);
  const others = newestFirst.filter((v) => !v.posted && !v.chosen);
  // The newest draft may still be chosen, even when a newer version was posted.
  const newestId = others[0]?.id;
  const keepProxy = new Set(others.slice(0, Math.max(0, keep)).map((v) => v.id));

  const actions: PruneAction[] = [];
  for (const v of others.slice().reverse()) {
    const media = v.mediaId !== null && v.id !== newestId;
    const proxy = v.proxyPath !== null && !keepProxy.has(v.id);
    if (media || proxy) actions.push({ id: v.id, media, proxy });
  }
  return actions;
}

/** "v3". */
export function versionLabel(number: number): string {
  return `v${number}`;
}
