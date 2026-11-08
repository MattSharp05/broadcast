import { describe, expect, it } from "vitest";
import {
  buildAccountDetails,
  buildPostDetails,
  connectionNote,
  daysLeft,
  followerChange,
  followerSince,
  grantedPermissions,
  permissionsLabel,
  type PostDetailInput,
  type PostMetricRow,
} from "./details";

const NOW = new Date("2026-11-05T22:14:00Z");
const LONDON = "Europe/London";
const H = 3_600_000;

function post(id: string, over: Partial<PostDetailInput> = {}): PostDetailInput {
  return {
    id,
    accountId: "a1",
    caption: `Caption ${id}`,
    timing: "queue",
    status: "published",
    lastError: null,
    attempts: 1,
    permalink: `https://example.test/${id}`,
    ...over,
  };
}

function metric(
  postId: string,
  offset: PostMetricRow["offset"],
  hoursAfter: number,
  views: number,
) {
  return {
    postId,
    offset,
    takenAt: new Date(NOW.getTime() - 100 * H + hoursAfter * H),
    views,
    reach: views * 2,
    likes: 10,
    comments: 2,
    shares: 1,
    saves: 3,
    missed: false,
  } satisfies PostMetricRow;
}

describe("post details", () => {
  it("takes the latest refresh's numbers and lists every refresh in order", () => {
    const d = buildPostDetails(
      [post("p1")],
      [metric("p1", "6h", 6, 400), metric("p1", "1h", 1, 120), metric("p1", "24h", 24, 900)],
    ).p1;
    expect(d?.stats).toEqual({
      views: 900,
      reach: 1800,
      likes: 10,
      comments: 2,
      shares: 1,
      saves: 3,
    });
    expect(d?.refreshedAt?.getTime()).toBe(NOW.getTime() - 76 * H);
    expect(d?.snapshots.map((s) => s.views)).toEqual([120, 400, 900, null, null]);
    expect(d?.nextRefresh).toBe("48h");
    expect(d?.permalink).toBe("https://example.test/p1");
  });

  it("has no stats before the first refresh, and is complete after the last", () => {
    const none = buildPostDetails([post("p1")], []).p1;
    expect(none?.stats).toBeNull();
    expect(none?.nextRefresh).toBe("1h");
    const done = buildPostDetails(
      [post("p2")],
      (["1h", "6h", "24h", "48h", "7d"] as const).map((o, i) => metric("p2", o, i + 1, 10 * i)),
    ).p2;
    expect(done?.nextRefresh).toBeNull();
  });

  it("a missed refresh is skipped: not the latest, not next, shown as missed", () => {
    const d = buildPostDetails(
      [post("p1")],
      [
        metric("p1", "1h", 1, 120),
        { ...metric("p1", "6h", 50, 0), views: null, missed: true },
        { ...metric("p1", "24h", 50, 0), views: null, missed: true },
        { ...metric("p1", "48h", 50, 700), shares: null },
      ],
    ).p1;
    expect(d?.stats).toMatchObject({ views: 700, shares: null });
    expect(d?.snapshots.map((s) => [s.offset, s.views, s.missed])).toEqual([
      ["1h", 120, false],
      ["6h", null, true],
      ["24h", null, true],
      ["48h", 700, false],
      ["7d", null, false],
    ]);
    expect(d?.nextRefresh).toBe("7d");
  });

  it("keeps the full error of a failed post, and no refreshes for waiting posts", () => {
    const failed = buildPostDetails(
      [post("f", { status: "failed", lastError: "Instagram rejected the video." })],
      [],
    ).f;
    expect(failed?.error).toBe("Instagram rejected the video.");
    expect(failed?.nextRefresh).toBeNull();
    const queued = buildPostDetails([post("q", { status: "queued", lastError: "old" })], []).q;
    expect(queued?.error).toBeNull();
  });
});

describe("account details", () => {
  const account = {
    id: "a1",
    handle: "codingjourney",
    brand: "Coding Journey",
    platform: "instagram",
    status: "ready" as const,
    statusReason: null,
    followers: 1240,
    description: "Daily notes",
    vaultUrl: null,
    slots: ["09:00", "13:00", "19:00"],
  };

  it("sums last week's views and posts, posts in the last 24 h, backlog and followers", () => {
    const [d] = buildAccountDetails({
      accounts: [account],
      posts: [
        {
          accountId: "a1",
          status: "published",
          publishedAt: new Date(NOW.getTime() - 3 * H),
          views: 100,
        },
        {
          accountId: "a1",
          status: "published",
          publishedAt: new Date(NOW.getTime() - 30 * H),
          views: 50,
        },
        {
          accountId: "a1",
          status: "published",
          publishedAt: new Date(NOW.getTime() - 200 * H),
          views: 999,
        },
        { accountId: "a1", status: "queued", publishedAt: null, views: null },
        { accountId: "a1", status: "paused", publishedAt: null, views: null },
        { accountId: "a1", status: "failed", publishedAt: null, views: null },
        { accountId: "other", status: "published", publishedAt: NOW, views: 7 },
      ],
      followers: [
        { accountId: "a1", day: "2026-11-05", followers: 1240 },
        { accountId: "a1", day: "2026-10-01", followers: 900 },
        { accountId: "a1", day: "2026-11-01", followers: 1200 },
      ],
      credentials: [
        {
          accountId: "a1",
          expiresAt: new Date("2026-12-16T22:14:00Z"),
          scopes: ["instagram_basic", "instagram_content_publish", "pages_read_engagement"],
        },
      ],
      now: NOW,
      timezone: LONDON,
    });
    expect(d?.views7d).toBe(150);
    expect(d?.posts7d).toBe(2);
    expect(d?.postsUsed24h).toBe(1);
    expect(d?.backlog).toBe(2);
    expect(d?.followerSeries).toEqual([
      { day: "2026-11-01", followers: 1200 },
      { day: "2026-11-05", followers: 1240 },
    ]);
    expect(d?.profileUrl).toBe("https://www.instagram.com/codingjourney/");
    expect(d?.connection?.permissions).toEqual(["profile", "publishing"]);
    expect(d?.connection && daysLeft(d.connection.expiresAt ?? NOW, NOW)).toBe(41);
  });

  it("has no connection without a stored token", () => {
    const [d] = buildAccountDetails({
      accounts: [account],
      posts: [],
      followers: [],
      credentials: [],
      now: NOW,
      timezone: LONDON,
    });
    expect(d?.connection).toBeNull();
    expect(d?.views7d).toBe(0);
  });

  it("charts 30 days ending today", () => {
    expect(followerSince(NOW, LONDON)).toBe("2026-10-07");
  });

  it("labels permissions and the connection", () => {
    expect(grantedPermissions("fake", ["fake_insights", "fake_basic"])).toEqual([
      "profile",
      "insights",
    ]);
    expect(permissionsLabel(["profile", "publishing", "insights"])).toBe(
      "Profile, publishing, insights",
    );
    expect(permissionsLabel([])).toBe("None granted");
    expect(connectionNote({ status: "ready", statusReason: null })).toMatch(/renews automatically/);
    expect(connectionNote({ status: "needs_attention", statusReason: "Access expired." })).toBe(
      "Access expired.",
    );
    expect(daysLeft(new Date(NOW.getTime() - H), NOW)).toBeLessThan(0);
  });

  it("measures the follower change over the range", () => {
    expect(followerChange([])).toBeNull();
    expect(followerChange([{ day: "a", followers: 5 }])).toBeNull();
    expect(
      followerChange([
        { day: "a", followers: 5 },
        { day: "b", followers: 12 },
      ]),
    ).toBe(7);
  });
});
