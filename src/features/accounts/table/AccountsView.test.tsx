import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TagFilter } from "@/components/TagFilter";
import type { AccountRow } from "@/lib/domain/accounts";
import type { AccountsActions } from "./actions";
import { AccountsView } from "./AccountsView";
import { accountsStats } from "./stats";

const ok = vi.fn(() => Promise.resolve({ ok: true as const, value: "" }));
const actions = {
  updateAccountTags: ok,
  updateAccountDescription: ok,
  addBrand: ok,
  updateBrandName: ok,
} as unknown as AccountsActions;
const workspace = { id: "00000000-0000-4000-8000-000000000002", kind: "sandbox" as const };

function row(
  id: string,
  handle: string,
  brand: string,
  over: Partial<AccountRow> = {},
): AccountRow {
  return {
    id,
    handle,
    platform: "fake",
    brandId: `b-${brand}`,
    brand,
    tags: [],
    description: "",
    status: "ready",
    statusReason: null,
    followers: 1240,
    slotsPerDay: 3,
    backlog: 10,
    profileUrl: `https://www.instagram.com/${handle}/`,
    avatar: 2,
    ...over,
  };
}

describe("AccountsView", () => {
  const rows = [
    row("trip", "trip.app", "Trip", { tags: ["App"] }),
    row("tri", "tri.weekly", "Sport", {
      status: "needs_attention",
      statusReason: "Instagram access expired on 2 Nov. Reconnect to resume posting.",
      tags: ["Sport", "App"],
    }),
  ];

  it("renders brand groups A–Z with counts, rows and the stats", () => {
    const html = renderToStaticMarkup(
      <AccountsView
        accounts={rows}
        brands={[
          { id: "b-Trip", name: "Trip" },
          { id: "b-Sport", name: "Sport" },
          { id: "b-new", name: "Kart Racer" },
        ]}
        workspace={workspace}
        actions={actions}
      />,
    );
    const groups = [...html.matchAll(/data-brand="([^"]+)"/g)].map((m) => m[1]);
    expect(groups).toEqual(["Kart Racer", "Sport", "Trip"]);
    expect(html).toContain("0 accounts");
    expect(html).toContain("1 account<");
    expect(html).toContain(
      'href="https://www.instagram.com/trip.app/" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toContain("Instagram access expired on 2 Nov.");
    expect(html).not.toContain("Reconnect to resume posting.</div>");
    expect(html).toContain("Needs attention");
    expect(html).toContain("App (2)");
    expect(html).toContain("All tags");
    expect(html).toContain("1,240");
    expect(html).not.toContain("Add your first account");
  });

  it("shows the empty state when there is nothing at all", () => {
    const html = renderToStaticMarkup(
      <AccountsView accounts={[]} brands={[]} workspace={workspace} actions={actions} />,
    );
    expect(html).toContain("No accounts yet. Add your first account to start posting.");
    expect(html).not.toContain("<table");
    // Add account is enabled (BC-13): no disabled button any more.
    expect(html).toMatch(/<button[^>]*>.*Add account<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>.*Add account/);
  });
});

describe("accountsStats", () => {
  it("reads like the mockup", () => {
    expect(accountsStats({ accounts: 5, ready: 4, attention: 1 })).toEqual([
      { value: 5, label: "accounts" },
      { value: 4, label: "ready to publish" },
      { value: 1, label: "needs attention" },
    ]);
    expect(accountsStats({ accounts: 1, ready: 0, attention: 2 }).map((s) => s.label)).toEqual([
      "account",
      "ready to publish",
      "need attention",
    ]);
  });
});

describe("TagFilter", () => {
  it("shows counts and a custom first option when given", () => {
    const html = renderToStaticMarkup(
      <TagFilter
        tags={["Tech"]}
        value=""
        onChange={() => undefined}
        allLabel="All tags"
        counts={new Map([["Tech", 2]])}
      />,
    );
    expect(html).toContain(">All tags<");
    expect(html).toContain(">Tech (2)<");
    expect(
      renderToStaticMarkup(<TagFilter tags={["Tech"]} value="" onChange={() => undefined} />),
    ).toContain(">Tech<");
  });
});
