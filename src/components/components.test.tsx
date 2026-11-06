import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppRail } from "./AppRail";
import { Button } from "./Button";
import { NAV_ITEMS, isActivePath } from "./nav";
import { PageHeader } from "./PageHeader";
import { Select } from "./Select";
import { StatusDot } from "./StatusDot";
import { Tag } from "./Tag";

const pathname = vi.hoisted(() => ({ current: "/workflow" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

describe("nav", () => {
  it("lists the three tabs in order", () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(["/workflow", "/accounts", "/factory"]);
  });

  it("marks a tab active on its route and sub-routes only", () => {
    expect(isActivePath("/accounts", "/accounts")).toBe(true);
    expect(isActivePath("/accounts/abc", "/accounts")).toBe(true);
    expect(isActivePath("/accountsx", "/accounts")).toBe(false);
    expect(isActivePath("/workflow", "/accounts")).toBe(false);
  });
});

describe("AppRail", () => {
  it.each(["/workflow", "/accounts", "/factory"])(
    "highlights only %s with aria-current",
    (path) => {
      pathname.current = path;
      const html = renderToStaticMarkup(<AppRail />);
      const current = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)];
      expect(current).toHaveLength(1);
      expect(current[0]?.[0]).toContain(`href="${path}"`);
    },
  );

  it("shows the brand, the v1 marker and the scheduler placeholder", () => {
    pathname.current = "/workflow";
    const html = renderToStaticMarkup(<AppRail />);
    expect(html).toContain("Broadcast");
    expect(html).toContain("Content Factory");
    expect(html).toContain(">v1<");
    expect(html).toContain("Scheduler not running yet");
    expect(html).toContain('aria-label="Main"');
  });
});

describe("Button", () => {
  it("defaults to a secondary type=button", () => {
    const html = renderToStaticMarkup(<Button>Cancel</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain('data-variant="secondary"');
  });

  it.each(["primary", "secondary", "ghost", "danger"] as const)("renders the %s variant", (v) => {
    expect(renderToStaticMarkup(<Button variant={v}>Go</Button>)).toContain(`data-variant="${v}"`);
  });
});

describe("PageHeader", () => {
  it("renders the title, the stats line in DESIGN.md order and the actions", () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="Workflow"
        stats={[
          { value: 13, label: "scheduled" },
          { value: "in 9 h 46 min", label: "Next post", labelFirst: true },
          { value: 1, label: "failed", tone: "bad" },
        ]}
        actions={<Button variant="primary">Add content</Button>}
      />,
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<b>13</b> scheduled");
    expect(html).toContain("Next post <b>in 9 h 46 min</b>");
    expect(html).toContain('data-tone="bad"><b>1</b> failed');
    expect(html).toContain("Add content");
  });

  it("omits the stats line when there are none", () => {
    expect(renderToStaticMarkup(<PageHeader title="Content Factory" />)).not.toContain("<ul");
  });
});

describe("StatusDot, Tag, Select", () => {
  it("renders a dot with its word, or a bare hidden dot", () => {
    expect(renderToStaticMarkup(<StatusDot tone="good">Ready</StatusDot>)).toMatch(
      /data-tone="good">Ready</,
    );
    expect(renderToStaticMarkup(<StatusDot tone="warn" />)).toContain('aria-hidden="true"');
  });

  it("shows the remove button only when removable", () => {
    expect(renderToStaticMarkup(<Tag label="coding" />)).not.toContain("<button");
    expect(
      renderToStaticMarkup(
        <Tag
          label="coding"
          onRemove={() => {
            /* noop */
          }}
        />,
      ),
    ).toContain('aria-label="Remove tag coding"');
  });

  it("wraps the select in its visible label", () => {
    const html = renderToStaticMarkup(
      <Select label="Tag" defaultValue="all">
        <option value="all">All tags</option>
      </Select>,
    );
    expect(html).toMatch(/^<label[^>]*>Tag<select/);
  });
});
