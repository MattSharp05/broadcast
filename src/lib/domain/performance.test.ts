import { describe, expect, it } from "vitest";
import {
  aggregatePerformance,
  changeLabel,
  type PerformanceData,
  type PostPerformance,
} from "./performance";

const NOW = new Date("2026-11-12T12:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

function post(
  accountId: string,
  daysAgo: number,
  views: number | null,
  likes: number | null = 1,
): PostPerformance {
  return {
    accountId,
    publishedAt: at(daysAgo),
    views,
    reach: null,
    likes,
    comments: 0,
    shares: null,
    saves: null,
  };
}

const data: PerformanceData = {
  posts: [
    post("a", 1, 100),
    post("a", 3, 50),
    post("b", 2, 30),
    post("a", 9, 60),
    post("b", 40, 999),
  ],
  followers: [
    { accountId: "a", day: "2026-11-12", followers: 1100 },
    { accountId: "a", day: "2026-11-05", followers: 1000 },
    { accountId: "b", day: "2026-11-12", followers: 500 },
    { accountId: "b", day: "2026-11-05", followers: 500 },
  ],
  current: { a: 1100, b: 500, c: 42 },
};

describe("performance totals", () => {
  it("sums each post's latest numbers in the period and compares with the period before", () => {
    const t = aggregatePerformance({ data, accountIds: ["a", "b"], period: "7d", now: NOW });
    expect(t.views).toEqual({ value: 180, change: 2 }); // 180 vs 60
    expect(t.likes.value).toBe(3);
    expect(t.followers.value).toBe(1600);
    expect(t.followers.change).toBeCloseTo(100 / 1500, 5);
  });

  it("shows nothing (—) for a number no post reported", () => {
    const t = aggregatePerformance({ data, accountIds: ["a", "b"], period: "7d", now: NOW });
    expect(t.reach).toEqual({ value: null, change: null });
    expect(t.comments.value).toBe(0);
  });

  it("follows the Tag filter: only the accounts shown", () => {
    const t = aggregatePerformance({ data, accountIds: ["b"], period: "7d", now: NOW });
    expect(t.views.value).toBe(30);
    expect(t.followers.value).toBe(500);
  });

  it("all time has no comparison; an account without history uses its current count", () => {
    const t = aggregatePerformance({ data, accountIds: ["a", "b", "c"], period: "all", now: NOW });
    expect(t.views).toEqual({ value: 1239, change: null });
    expect(t.followers).toEqual({ value: 1642, change: null });
  });

  it("labels changes plainly", () => {
    expect(changeLabel(0.123)).toBe("+12%");
    expect(changeLabel(-0.04)).toBe("−4%");
    expect(changeLabel(0.001)).toBe("0%");
    expect(changeLabel(null)).toBeNull();
  });
});
