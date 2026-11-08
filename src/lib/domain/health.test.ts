import { describe, expect, it } from "vitest";
import { ProviderError } from "@/lib/providers/types";
import { isAuthError } from "@/lib/providers/errors";
import {
  CONNECTION_CHECK_MS,
  attentionLine,
  connectionCheckDue,
  expiredReason,
  reconnectLaterLine,
  reconnectSoonReason,
  reconnectedMessage,
  refreshFailedReason,
  refreshFailure,
  refreshPlan,
  unrenewablePlan,
} from "./health";

const NOW = new Date("2026-11-05T22:14:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("refreshPlan: age and expiry windows", () => {
  it("refreshes a token older than 24 h that expires within 7 days", () => {
    expect(refreshPlan({ lastRefreshedAt: at(-50 * DAY), expiresAt: at(3 * DAY) }, NOW)).toBe(
      "refresh",
    );
  });

  it("refreshes right at the edges: 24 h old, 7 days left", () => {
    expect(refreshPlan({ lastRefreshedAt: at(-DAY), expiresAt: at(7 * DAY) }, NOW)).toBe("refresh");
  });

  it("leaves a token refreshed less than 24 h ago alone, even close to expiry", () => {
    expect(refreshPlan({ lastRefreshedAt: at(-DAY + 60_000), expiresAt: at(2 * DAY) }, NOW)).toBe(
      "none",
    );
  });

  it("leaves a token with more than 7 days left alone", () => {
    expect(
      refreshPlan({ lastRefreshedAt: at(-30 * DAY), expiresAt: at(7 * DAY + 60_000) }, NOW),
    ).toBe("none");
  });

  it("treats an unknown refresh time as old enough", () => {
    expect(refreshPlan({ lastRefreshedAt: null, expiresAt: at(DAY) }, NOW)).toBe("refresh");
  });

  it("has nothing to refresh without an expiry", () => {
    expect(refreshPlan({ lastRefreshedAt: null, expiresAt: null }, NOW)).toBe("none");
  });

  it("an expired token can't be refreshed: the account needs reconnecting", () => {
    expect(refreshPlan({ lastRefreshedAt: at(-61 * DAY), expiresAt: at(-HOUR) }, NOW)).toBe(
      "expired",
    );
    expect(refreshPlan({ lastRefreshedAt: at(-HOUR), expiresAt: NOW }, NOW)).toBe("expired");
  });
});

describe("refreshFailure", () => {
  it("flags the account when access is gone or retrying can't help", () => {
    expect(refreshFailure({ code: "token_expired", retryable: false })).toBe("flag");
    expect(refreshFailure({ code: "unknown", retryable: false })).toBe("flag");
  });

  it("retries later when it may pass", () => {
    expect(refreshFailure({ code: "network", retryable: true })).toBe("retry");
    expect(refreshFailure({ code: "quota_exhausted", retryable: true })).toBe("retry");
  });
});

describe("connectionCheckDue", () => {
  it("checks a never-checked account and one not checked for a minute", () => {
    expect(connectionCheckDue(null, NOW)).toBe(true);
    expect(connectionCheckDue(at(-CONNECTION_CHECK_MS), NOW)).toBe(true);
    expect(connectionCheckDue(at(-CONNECTION_CHECK_MS + 1000), NOW)).toBe(false);
  });
});

describe("copy", () => {
  it("says when access expired, in the workspace timezone", () => {
    expect(expiredReason(new Date("2026-11-02T23:30:00Z"), "Europe/London")).toBe(
      "Instagram access expired on 2 Nov. Reconnect to resume posting.",
    );
    expect(expiredReason(new Date("2026-11-02T23:30:00Z"), "Europe/Berlin")).toMatch(/3 Nov/);
  });

  it("keeps a platform message that already says what to do", () => {
    expect(
      refreshFailedReason("Instagram access expired. Reconnect the account to resume posting."),
    ).toBe("Instagram access expired. Reconnect the account to resume posting.");
    expect(refreshFailedReason("Instagram didn't accept the request.")).toBe(
      "Broadcast couldn't renew Instagram access: Instagram didn't accept the request. Reconnect to resume posting.",
    );
  });

  it("the rail line counts accounts", () => {
    expect(attentionLine(0)).toBeNull();
    expect(attentionLine(1)).toBe("1 account needs attention");
    expect(attentionLine(3)).toBe("3 accounts need attention");
  });

  it("the reconnect toast", () => {
    expect(reconnectedMessage("tri.weekly", true)).toBe(
      "@tri.weekly reconnected. Its paused posts are back in the queue.",
    );
    expect(reconnectedMessage("tri.weekly", false)).toBe("@tri.weekly reconnected.");
  });
});

describe("isAuthError", () => {
  it("is true only for expired or revoked access", () => {
    const err = (code: "token_expired" | "network") =>
      new ProviderError({ code, retryable: code === "network", userMessage: "x" });
    expect(isAuthError(err("token_expired"))).toBe(true);
    expect(isAuthError(err("network"))).toBe(false);
    expect(isAuthError(new Error("token_expired"))).toBe(false);
  });
});

describe("unrenewablePlan (Facebook Login user tokens)", () => {
  const expires = new Date("2026-12-20T12:00:00Z");

  it("waits until 3 days before expiry, then flags", () => {
    expect(unrenewablePlan(expires, new Date("2026-12-14T12:00:00Z"))).toEqual({
      action: "wait",
      askAt: new Date("2026-12-17T12:00:00Z"),
    });
    expect(unrenewablePlan(expires, new Date("2026-12-17T12:00:00Z"))).toEqual({
      action: "flag",
    });
    expect(unrenewablePlan(expires, new Date("2026-12-19T00:00:00Z"))).toEqual({
      action: "flag",
    });
  });

  it("names the date and the fix", () => {
    expect(reconnectSoonReason(expires, "Europe/London")).toBe(
      "Instagram access ends on 20 Dec and Facebook doesn't let Broadcast renew it. Reconnect to keep posting.",
    );
    expect(reconnectLaterLine("cj", new Date("2026-12-17T12:00:00Z"), "UTC")).toMatch(
      /^Facebook doesn't let Broadcast renew access for @cj\. On 17 Dec/,
    );
  });
});
