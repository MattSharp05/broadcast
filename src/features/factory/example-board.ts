/** One card on the placeholder board. `source` is a video-editor path, shown as code. */
export interface ExampleIdea {
  title: string;
  /** Who the video is for, e.g. "@codingjourney". */
  forAccounts: string;
  source?: string;
}

export interface ExampleColumn {
  name: string;
  ideas: readonly ExampleIdea[];
}

/**
 * The static example board from docs/vision-mockup.html. Nothing here is real data: the
 * Content Factory is a placeholder until v1.
 */
export const EXAMPLE_BOARD: readonly ExampleColumn[] = [
  {
    name: "Ideas",
    ideas: [
      { title: "Why I let Claude run my tickets overnight", forAccounts: "@codingjourney" },
      { title: "Kart Racer: drift physics in 40 seconds", forAccounts: "@codingjourney" },
      { title: "What's an MCP server?", forAccounts: "@ai.explained.daily" },
    ],
  },
  {
    name: "Scripting",
    ideas: [
      {
        title: "Plan a weekend in 30 seconds",
        forAccounts: "@trip.app",
        source: "projects/trip-social-01/script.md",
      },
      { title: "Race-week taper, day by day", forAccounts: "@tri.weekly" },
    ],
  },
  {
    name: "In video-editor",
    ideas: [
      {
        title: "Trip launch film v2",
        forAccounts: "@trip.app and @codingjourney",
        source: "projects/trip-social-01/film-v2",
      },
    ],
  },
  {
    name: "Ready for the queue",
    ideas: [
      {
        title: "Page tips that convert",
        forAccounts: "@driftship",
        source: "renders/driftship-tips-03.mp4",
      },
    ],
  },
];
