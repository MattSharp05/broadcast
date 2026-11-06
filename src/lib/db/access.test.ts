import { describe, expect, it } from "vitest";
import { decideAccess, isAllowedEmail, isPublicPath, safeNextPath } from "./access";

describe("isAllowedEmail", () => {
  it("matches case- and whitespace-insensitively", () => {
    expect(isAllowedEmail(" Matt@Example.com ", "matt@example.com")).toBe(true);
  });

  it("rejects other emails", () => {
    expect(isAllowedEmail("someone@example.com", "matt@example.com")).toBe(false);
  });

  it("allows nobody when ALLOWED_EMAIL is unset or empty", () => {
    expect(isAllowedEmail("", "")).toBe(false);
    expect(isAllowedEmail("matt@example.com", undefined)).toBe(false);
    expect(isAllowedEmail(null, null)).toBe(false);
  });
});

describe("isPublicPath", () => {
  it.each(["/login", "/auth/callback", "/auth/sign-out", "/api/content", "/api"])(
    "%s is public",
    (p) => {
      expect(isPublicPath(p)).toBe(true);
    },
  );

  it.each(["/", "/workflow", "/accounts", "/loginx", "/authx", "/apix", "/dev"])(
    "%s needs sign-in",
    (p) => {
      expect(isPublicPath(p)).toBe(false);
    },
  );
});

describe("decideAccess", () => {
  const allowedEmail = "matt@example.com";

  it("sends signed-out visitors to /login", () => {
    expect(decideAccess({ pathname: "/workflow", userEmail: null, allowedEmail })).toBe("login");
  });

  it("lets the allowed user through", () => {
    expect(
      decideAccess({ pathname: "/workflow", userEmail: "MATT@example.com", allowedEmail }),
    ).toBe("allow");
  });

  it("marks any other signed-in user as private", () => {
    expect(decideAccess({ pathname: "/workflow", userEmail: "x@example.com", allowedEmail })).toBe(
      "private",
    );
  });

  it("always allows public paths", () => {
    expect(decideAccess({ pathname: "/login", userEmail: null, allowedEmail })).toBe("allow");
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/accounts?x=1")).toBe("/accounts?x=1");
  });

  it.each([null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example"])(
    "falls back for %s",
    (n) => {
      expect(safeNextPath(n)).toBe("/workflow");
    },
  );
});
