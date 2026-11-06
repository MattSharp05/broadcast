import { expect, test, type Locator, type Page } from "@playwright/test";

// BC-6: the canvas engine on its static demo page (/dev/canvas, 48 boxes in six columns).
// Desktop geometry (100% start, 56px "now" margin, minimap shown): phone projects skip it.
test.skip(({ viewport }) => (viewport?.width ?? 0) < 760, "desktop-only spec");

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no bounding box");
  return b;
}

const stage = (page: Page) => page.getByRole("region", { name: "Canvas engine demo" });
const zoomText = (page: Page) => page.getByLabel("Zoom level");
const firstHeader = (page: Page) => page.locator('[data-box="c1-0"]');

/** Union of the on-screen rectangles of every box and the now line. */
async function contentRect(page: Page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll("[data-box], [data-now-line]")];
    const rs = els.map((e) => e.getBoundingClientRect());
    return {
      x0: Math.min(...rs.map((r) => r.left)),
      y0: Math.min(...rs.map((r) => r.top)),
      x1: Math.max(...rs.map((r) => r.right)),
      y1: Math.max(...rs.map((r) => r.bottom)),
    };
  });
}

/** Waits until the world layer stops moving (animations last ~220 ms). */
async function settle(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      const now = await page
        .locator("[data-canvas-world]")
        .evaluate((el) => (el as HTMLElement).style.transform);
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

/** A point inside the stage away from the boxes, HUD and minimap. */
async function emptySpot(page: Page) {
  const s = await box(stage(page));
  const h = await box(firstHeader(page));
  // Left of the first column, a little below the now line.
  return { x: Math.max(s.x + 10, h.x - 30), y: h.y + h.height + 20 };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/canvas");
  await expect(stage(page)).toHaveAttribute("data-ready", "true");
  await expect(zoomText(page)).toHaveText("100%");
});

test("dragging moves the world by the drag distance", async ({ page }) => {
  const before = await box(firstHeader(page));
  const start = await emptySpot(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 75, start.y + 40, { steps: 3 });
  await page.mouse.move(start.x + 150, start.y + 80, { steps: 3 });
  await page.mouse.up();
  await settle(page);
  const after = await box(firstHeader(page));
  expect(after.x - before.x).toBeCloseTo(150, 0);
  expect(after.y - before.y).toBeCloseTo(80, 0);
});

test("a click on a box still works, but a drag that starts on a box doesn't click it", async ({
  page,
}) => {
  const header = firstHeader(page);
  await header.click();
  await expect(page.locator("header")).toContainText("Clicked Account 1");

  const b = await box(page.locator('[data-box="c2-0"]'));
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 120, b.y + 20, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("header")).toContainText("Clicked Account 1");
  await expect(page.locator("header")).not.toContainText("Clicked Account 2");
});

test("ctrl + wheel zooms around the pointer and changes the zoom %", async ({ page }) => {
  const h = await box(firstHeader(page));
  const at = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 60);
  await page.keyboard.up("Control");
  await settle(page);
  await expect(zoomText(page)).not.toHaveText("100%");
  const pct = parseInt((await zoomText(page).textContent()) ?? "", 10);
  expect(pct).toBeLessThan(100);
  // The point under the pointer stays put.
  const after = await box(firstHeader(page));
  expect(after.x + after.width / 2).toBeCloseTo(at.x, 0);
  expect(after.y + after.height / 2).toBeCloseTo(at.y, 0);
});

test("wheel scrolls; shift + wheel scrolls sideways", async ({ page }) => {
  const before = await box(firstHeader(page));
  const spot = await emptySpot(page);
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.wheel(0, 100);
  await settle(page);
  const scrolled = await box(firstHeader(page));
  expect(scrolled.y - before.y).toBeCloseTo(-100, 0);
  expect(scrolled.x).toBeCloseTo(before.x, 0);

  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 100);
  await page.keyboard.up("Shift");
  await settle(page);
  const sideways = await box(firstHeader(page));
  expect(sideways.x - scrolled.x).toBeCloseTo(-100, 0);
  expect(sideways.y).toBeCloseTo(scrolled.y, 0);
});

test("the zoom buttons step the zoom", async ({ page }) => {
  await page.getByRole("button", { name: "Zoom in" }).click();
  await settle(page);
  await expect(zoomText(page)).toHaveText("120%");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await settle(page);
  await expect(zoomText(page)).toHaveText("83%");
});

test("Fit all shows every box", async ({ page }) => {
  await page.getByRole("button", { name: "Fit all" }).click();
  await settle(page);
  const s = await box(stage(page));
  const c = await contentRect(page);
  expect(c.x0).toBeGreaterThanOrEqual(s.x);
  expect(c.y0).toBeGreaterThanOrEqual(s.y);
  expect(c.x1).toBeLessThanOrEqual(s.x + s.width);
  expect(c.y1).toBeLessThanOrEqual(s.y + s.height);
});

test("clicking the minimap centres that area", async ({ page }) => {
  // Move far away first.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await settle(page);
  const spot = await emptySpot(page);
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x - 400, spot.y - 300, { steps: 5 });
  await page.mouse.up();
  await settle(page);

  // The map's centre is the content's centre (the minimap fits the content, centred).
  const map = page.getByRole("img", { name: /Minimap/ });
  await map.click();
  await settle(page);
  const s = await box(stage(page));
  const c = await contentRect(page);
  expect(Math.abs((c.x0 + c.x1) / 2 - (s.x + s.width / 2))).toBeLessThan(3);
  expect(Math.abs((c.y0 + c.y1) / 2 - (s.y + s.height / 2))).toBeLessThan(3);
});

test("Back to now puts the now line back at the middle, on the left", async ({ page }) => {
  const nowTag = page.getByText("Now", { exact: true });
  const home = await box(nowTag);
  const spot = await emptySpot(page);
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x - 300, spot.y + 250, { steps: 5 });
  await page.mouse.up();
  await settle(page);
  expect((await box(nowTag)).x).not.toBeCloseTo(home.x, 0);

  await page.getByRole("button", { name: "Back to now" }).click();
  await settle(page);
  const s = await box(stage(page));
  const tag = await box(nowTag);
  expect(tag.x - s.x).toBeCloseTo(56, 0);
  expect(tag.y + tag.height / 2).toBeCloseTo(s.y + s.height / 2, 0);
});

test("the view survives a reload in the same session", async ({ page }) => {
  const spot = await emptySpot(page);
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x + 120, spot.y - 90, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await settle(page);
  const before = await box(firstHeader(page));
  const pct = await zoomText(page).textContent();
  await page.waitForTimeout(400); // the view is saved 250 ms after the last move
  await page.reload();
  await expect(stage(page)).toHaveAttribute("data-ready", "true");
  await expect(zoomText(page)).toHaveText(pct ?? "");
  const after = await box(firstHeader(page));
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
});

test("a two-finger pinch zooms (touch)", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "uses CDP touch events");
  const s = await box(stage(page));
  const cx = s.x + s.width / 2;
  const cy = s.y + s.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", d: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd"
          ? []
          : [
              { x: cx - d, y: cy, id: 1 },
              { x: cx + d, y: cy, id: 2 },
            ],
    });
  await touch("touchStart", 50);
  for (const d of [60, 70, 80, 90, 100]) await touch("touchMove", d);
  await touch("touchEnd", 100);
  await settle(page);
  // Fingers twice as far apart: about twice the zoom.
  await expect(zoomText(page)).toHaveText("180%");
});
