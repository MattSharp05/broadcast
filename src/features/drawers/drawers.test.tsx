import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AccountDetail, PostDetail } from "@/lib/domain/details";
import { AccountDetails, profileLabel } from "./AccountDetails";
import { RefreshChart } from "./charts";
import { PostDetails } from "./PostDetails";
import { Preview } from "./previews";

const NOW = new Date("2026-11-05T22:14:00Z");
const clock = { now: NOW, timezone: "Europe/London" };

const account: AccountDetail = {
  id: "a1",
  handle: "codingjourney",
  brand: "Coding Journey",
  platform: "fake",
  avatar: 2,
  profileUrl: "https://www.instagram.com/codingjourney/",
  status: "needs_attention",
  statusReason: "Instagram access expired on 2 Nov. Reconnect to resume posting.",
  followers: 1240,
  description: "Daily notes",
  vaultUrl: "javascript:alert(1)",
  slots: ["09:00", "19:00"],
  backlog: 4,
  followerSeries: [
    { day: "2026-11-04", followers: 1200 },
    { day: "2026-11-05", followers: 1240 },
  ],
  views7d: 5400,
  posts7d: 9,
  postsUsed24h: 3,
  connection: null,
};

const posted: PostDetail = {
  id: "p1",
  accountId: "a1",
  caption: "Day 41",
  timing: "queue",
  error: null,
  attempts: 1,
  permalink: "https://fake.broadcast.invalid/codingjourney/reel/x",
  stats: { views: 1500, reach: 1200, likes: 90, comments: 7, shares: 4, saves: 11 },
  refreshedAt: new Date(NOW.getTime() - 3 * 3_600_000),
  snapshots: [
    { offset: "1h", views: 300 },
    { offset: "6h", views: 1500 },
    { offset: "24h", views: null },
    { offset: "48h", views: null },
    { offset: "7d", views: null },
  ],
  nextRefresh: "24h",
};

describe("drawers", () => {
  it("account: profile button opens the profile in a new tab; unsafe vault links aren't links", () => {
    const html = renderToStaticMarkup(<AccountDetails account={account} clock={clock} />);
    expect(html).toContain(
      'href="https://www.instagram.com/codingjourney/" target="_blank" rel="noopener noreferrer" data-profile-link=""',
    );
    expect(html).toContain("Open @codingjourney on Instagram");
    expect(html).toContain("Instagram access expired on 2 Nov");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("None stored (Sandbox example account)");
    expect(html).toContain("+40");
    expect(profileLabel(account.profileUrl)).toBe("instagram.com/codingjourney");
  });

  it("posted: six numbers, refresh history and links", () => {
    const card = {
      kind: "posted" as const,
      id: "p1",
      title: "Day 41",
      durationS: 30,
      thumbnailUrl: null,
      at: new Date(NOW.getTime() - 9 * 3_600_000),
      views: 1500,
      likes: 90,
      comments: 7,
    };
    const html = renderToStaticMarkup(
      <PostDetails card={card} account={account} detail={posted} clock={clock} />,
    );
    for (const label of ["Views", "Reach", "Likes", "Comments", "Shares", "Saves"]) {
      expect(html).toContain(`<dt>${label}</dt>`);
    }
    expect(html).toContain("24 h after posting");
    expect(html).toContain("Open the post");
    expect(html).toContain('data-chart="refreshes"');

    const preview = renderToStaticMarkup(
      <Preview target={{ kind: "post", card, account, detail: posted }} clock={clock} />,
    );
    expect(preview).toContain("Stats refreshed 3 h ago");
    expect(preview).toContain("1.5K");
  });

  it("refresh chart: latest bar solid, missing refreshes dashed", () => {
    const html = renderToStaticMarkup(<RefreshChart snapshots={posted.snapshots} />);
    expect(html.match(/data-bar="missing"/g)).toHaveLength(3);
    expect(html.match(/data-bar="latest"/g)).toHaveLength(1);
  });

  it("open slot: Add a video is disabled until Add content exists", () => {
    const card = { kind: "open" as const, id: "o1", at: new Date("2026-11-06T09:00:00Z") };
    const html = renderToStaticMarkup(<PostDetails card={card} account={account} clock={clock} />);
    expect(html).toContain("4 videos are waiting.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Add a video for this slot/);
  });

  it("open slot: Add a video is enabled once Add content is wired (BC-14)", () => {
    const card = { kind: "open" as const, id: "o1", at: new Date("2026-11-06T09:00:00Z") };
    const html = renderToStaticMarkup(
      <PostDetails card={card} account={account} clock={clock} onAddContent={() => undefined} />,
    );
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>.*Add a video for this slot/);
  });
});
