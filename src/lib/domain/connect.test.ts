import { describe, expect, it } from "vitest";
import { PERSONAL_ACCOUNT_MESSAGE, connectionStatus, requiredScopes } from "./connect";

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
      grantedScopes: ["instagram_business_basic", "instagram_business_manage_insights"],
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
