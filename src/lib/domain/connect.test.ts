import { describe, expect, it } from "vitest";
import {
  PERSONAL_ACCOUNT_MESSAGE,
  chooseAccount,
  connectionStatus,
  requiredScopes,
} from "./connect";

const ALL_IG = requiredScopes("instagram");

describe("connectionStatus", () => {
  it("is ready when every permission was granted", () => {
    expect(
      connectionStatus({ platform: "instagram", grantedScopes: ALL_IG, accountType: "BUSINESS" }),
    ).toEqual({ status: "ready", reason: null });
    expect(connectionStatus({ platform: "fake", grantedScopes: requiredScopes("fake") })).toEqual({
      status: "ready",
      reason: null,
    });
  });

  it("names the missing publishing permission", () => {
    const res = connectionStatus({
      platform: "instagram",
      grantedScopes: [
        "instagram_basic",
        "instagram_manage_insights",
        "pages_show_list",
        "pages_read_engagement",
      ],
    });
    expect(res).toEqual({
      status: "needs_attention",
      reason: "Publishing permission wasn't granted. Reconnect and allow publishing.",
    });
  });

  it("names insights when only insights is missing", () => {
    const res = connectionStatus({
      platform: "fake",
      grantedScopes: ["fake_basic", "fake_content_publish"],
    });
    expect(res.status).toBe("needs_attention");
    expect(res.reason).toMatch(/Insights permission/);
  });

  it("puts publishing first when several are missing", () => {
    expect(connectionStatus({ platform: "instagram", grantedScopes: [] }).reason).toMatch(
      /^Publishing permission/,
    );
  });

  it("flags a personal Instagram account", () => {
    expect(
      connectionStatus({ platform: "instagram", grantedScopes: ALL_IG, accountType: "PERSONAL" }),
    ).toEqual({ status: "needs_attention", reason: PERSONAL_ACCOUNT_MESSAGE });
    expect(
      connectionStatus({
        platform: "instagram",
        grantedScopes: ALL_IG,
        accountType: "MEDIA_CREATOR",
      }).status,
    ).toBe("ready");
  });
});

describe("requiredScopes (Instagram API with Facebook Login)", () => {
  it("needs basic, content publish, insights and the Page's engagement read", () => {
    expect(requiredScopes("instagram").sort()).toEqual([
      "instagram_basic",
      "instagram_content_publish",
      "instagram_manage_insights",
      "pages_read_engagement",
    ]);
  });

  it("publishing without pages_read_engagement is missing publishing", () => {
    expect(
      connectionStatus({
        platform: "instagram",
        grantedScopes: [
          "instagram_basic",
          "instagram_content_publish",
          "instagram_manage_insights",
        ],
      }).reason,
    ).toMatch(/^Publishing permission/);
  });
});

describe("chooseAccount", () => {
  const none = new Set<string>();

  it("takes the only shared account", () => {
    expect(chooseAccount({ shared: ["ig1"], reconnecting: null, connected: none })).toEqual({
      platformUserId: "ig1",
    });
  });

  it("no shared account is no_instagram", () => {
    expect(chooseAccount({ shared: [], reconnecting: null, connected: none })).toEqual({
      error: "no_instagram",
    });
  });

  it("a reconnect takes its own account, or is the wrong account", () => {
    expect(
      chooseAccount({ shared: ["ig1", "ig2"], reconnecting: "ig2", connected: new Set(["ig2"]) }),
    ).toEqual({ platformUserId: "ig2" });
    expect(chooseAccount({ shared: ["ig1"], reconnecting: "ig2", connected: none })).toEqual({
      error: "wrong_account",
    });
  });

  it("a reconnect of an account without a known id only takes an account not yet connected", () => {
    expect(
      chooseAccount({
        shared: ["ig1"],
        reconnecting: null,
        connected: new Set(["ig1"]),
        mustBeNew: true,
      }),
    ).toEqual({ error: "wrong_account" });
    expect(
      chooseAccount({
        shared: ["ig1", "ig2"],
        reconnecting: null,
        connected: new Set(["ig1"]),
        mustBeNew: true,
      }),
    ).toEqual({ platformUserId: "ig2" });
  });

  it("several shared: the only new one, else ambiguous", () => {
    expect(
      chooseAccount({ shared: ["ig1", "ig2"], reconnecting: null, connected: new Set(["ig1"]) }),
    ).toEqual({ platformUserId: "ig2" });
    expect(chooseAccount({ shared: ["ig1", "ig2"], reconnecting: null, connected: none })).toEqual({
      error: "several_accounts",
    });
    expect(
      chooseAccount({
        shared: ["ig1", "ig2"],
        reconnecting: null,
        connected: new Set(["ig1", "ig2"]),
      }),
    ).toEqual({ error: "several_accounts" });
  });
});
