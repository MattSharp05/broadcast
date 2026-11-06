import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CanvasColumn } from "@/lib/domain/canvas";
import { AccountHeader, PostedPostCard, Thumb, UpcomingPostCard } from "./cards";

const clock = { now: new Date("2026-11-05T22:14:00Z"), timezone: "Europe/London" };
const rect = { x0: 0, y0: 0, x1: 256, y1: 104 };

const column: CanvasColumn = {
  id: "a",
  handle: "codingjourney",
  brand: "Coding Journey",
  platform: "fake",
  tags: [],
  status: "ready",
  statusReason: null,
  followers: 1240,
  backlog: 9,
  profileUrl: "https://www.instagram.com/codingjourney/",
  avatar: 1,
  upcoming: [],
  moreInBacklog: 0,
  posted: [],
  next: { kind: "none" },
};

describe("canvas cards", () => {
  it("renders the account header with a new-tab profile link and the footer facts", () => {
    const html = renderToStaticMarkup(<AccountHeader column={column} rect={rect} />);
    expect(html).toContain("@codingjourney");
    expect(html).toContain("Coding Journey, Instagram");
    expect(html).toContain('href="https://www.instagram.com/codingjourney/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("<b>1.2K</b> followers");
    expect(html).toContain("<b>9</b> in backlog");
  });

  it("marks a header that needs attention", () => {
    const html = renderToStaticMarkup(
      <AccountHeader column={{ ...column, status: "needs_attention" }} rect={rect} />,
    );
    expect(html).toContain("data-attention");
    expect(html).toContain("Needs reconnecting");
    expect(html).not.toContain("followers");
  });

  it("renders scheduled, pinned and open upcoming cards", () => {
    const base = { id: "p", title: "Day 41", durationS: 42, thumbnailUrl: null };
    const at = new Date("2026-11-06T13:00:00Z");
    const scheduled = renderToStaticMarkup(
      <UpcomingPostCard
        card={{ ...base, kind: "scheduled", at }}
        rect={rect}
        colour={1}
        clock={clock}
      />,
    );
    expect(scheduled).toContain("Tomorrow, 13:00");
    expect(scheduled).toContain("Scheduled");
    expect(scheduled).toContain("Queue slot");
    expect(scheduled).toContain("0:42");
    const pinned = renderToStaticMarkup(
      <UpcomingPostCard
        card={{ ...base, kind: "pinned", at }}
        rect={rect}
        colour={1}
        clock={clock}
      />,
    );
    expect(pinned).toContain("Pinned");
    expect(pinned).toContain("Fixed time");
    const open = renderToStaticMarkup(
      <UpcomingPostCard
        card={{ kind: "open", id: "o", at }}
        rect={rect}
        colour={1}
        clock={clock}
      />,
    );
    expect(open).toContain('data-kind="open"');
    expect(open).toContain("Open slot. Fills from the backlog.");
  });

  it("renders posted metrics and a failed reason", () => {
    const base = { id: "p", title: "Day 40", durationS: 30, thumbnailUrl: null };
    const at = new Date("2026-11-05T19:00:00Z");
    const posted = renderToStaticMarkup(
      <PostedPostCard
        card={{ ...base, kind: "posted", at, views: 5410, likes: 210, comments: 12 }}
        rect={rect}
        colour={2}
        clock={clock}
      />,
    );
    expect(posted).toContain("Today, 19:00");
    expect(posted).toContain("5.4K");
    expect(posted).toContain("210");
    const failed = renderToStaticMarkup(
      <PostedPostCard
        card={{ ...base, kind: "failed", at, reason: "Wrong aspect ratio. Open to fix." }}
        rect={rect}
        colour={2}
        clock={clock}
      />,
    );
    expect(failed).toContain('data-kind="failed"');
    expect(failed).toContain("Wrong aspect ratio. Open to fix.");
  });

  it("shows the real thumbnail when there is one, else the placeholder", () => {
    expect(
      renderToStaticMarkup(<Thumb url="https://x.test/t.jpg" durationS={30} colour={3} />),
    ).toContain('<img src="https://x.test/t.jpg"');
    const placeholder = renderToStaticMarkup(<Thumb url={null} durationS={30} colour={3} />);
    expect(placeholder).not.toContain("<img");
    expect(placeholder).toContain("var(--avatar-3)");
  });
});
