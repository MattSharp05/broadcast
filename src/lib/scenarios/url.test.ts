import { describe, expect, it } from "vitest";
import { scenarioHref, scenarioRedirect } from "./url";

const at = (path: string) => scenarioRedirect(new URL(path, "http://localhost:3000"));

describe("scenarioRedirect", () => {
  it("leaves ordinary requests alone", () => {
    expect(at("/workflow")).toBeNull();
    expect(at("/workflow?tag=Tech")).toBeNull();
  });

  it("sends ?scenario= to the scenario loader, keeping the page and other params", () => {
    const target = new URL(at("/workflow?scenario=canvas-busy&tag=Tech") ?? "", "http://x");
    expect(target.pathname).toBe("/api/dev/scenario/canvas-busy");
    expect(target.searchParams.get("next")).toBe("/workflow?tag=Tech");
    expect(target.searchParams.has("now")).toBe(false);
  });

  it("passes ?now= along with the scenario", () => {
    const target = new URL(
      at("/accounts?scenario=empty&now=2026-11-05T22:14:00Z") ?? "",
      "http://x",
    );
    expect(target.pathname).toBe("/api/dev/scenario/empty");
    expect(target.searchParams.get("now")).toBe("2026-11-05T22:14:00Z");
    expect(target.searchParams.get("next")).toBe("/accounts");
  });

  it("sends ?now= alone to the clock", () => {
    const target = new URL(at("/workflow?now=2026-11-05T22:14:00Z") ?? "", "http://x");
    expect(target.pathname).toBe("/api/dev/clock");
    expect(target.searchParams.get("next")).toBe("/workflow");
  });

  it("encodes odd scenario names", () => {
    expect(at("/workflow?scenario=a/b")).toMatch(/^\/api\/dev\/scenario\/a%2Fb\?/);
  });
});

it("scenarioHref links the Workflow tab", () => {
  expect(scenarioHref("canvas-busy")).toBe("/workflow?scenario=canvas-busy");
});
