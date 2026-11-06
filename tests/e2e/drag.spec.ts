import type { Locator, Page } from "@playwright/test";
import { stableUuid } from "../../src/lib/hash";
import { expect, test } from "./fixtures";

// BC-22: dragging queued cards on canvas-busy (reorder within @codingjourney, move to an open
// slot of @trip.app, Undo, Escape) and the keyboard alternative "Move to…" in the post drawer.
// At the frozen now (Thu 22:14) @codingjourney shows q0 Tomorrow 09:00, q1 Tomorrow 13:00, a pin
// Tomorrow 19:00 and q2 Sat 09:00; @trip.app shows q0, q1 and open slots from Sat 12:00.

const id = (...parts: string[]) => stableUuid("canvas-busy", ...parts);
const cj = (i: number) => id("post", "cj", "q", String(i));
const PIN = id("post", "cj", "pinned");
const card = (page: Page, postId: string) => page.locator(`[data-post="${postId}"]`);
const stage = (page: Page) => page.getByRole("region", { name: "Workflow canvas" });
const toast = (page: Page) => page.getByTestId("toast");
const drawer = (page: Page) => page.getByRole("dialog");

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no bounding box");
  return b;
}

/** "Tomorrow, 09:00" from a card's label ("Title, Scheduled, Tomorrow, 09:00"). */
async function when(locator: Locator): Promise<string> {
  const label = (await locator.getAttribute("aria-label")) ?? "";
  return label.split(/, (?:Scheduled|Pinned|Paused|Publishing), /)[1] ?? "";
}

/** Waits until the world layer stops moving. */
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

/** canvas-busy at 69% (two zoom-out steps): every upcoming card of the first columns shows. */
async function ready(page: Page) {
  await expect(stage(page)).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await settle(page);
}

/** A mouse drag from the middle of `from` to a point, in small steps like a hand. */
async function drag(page: Page, from: Locator, to: { x: number; y: number }) {
  const b = await box(from);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
}

test.describe("mouse", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 760, "desktop mouse drags");

  test("dragging @codingjourney's 1st queued card onto its 3rd slot reorders the queue; Undo restores it", async ({
    page,
    loadScenario,
  }) => {
    await loadScenario("canvas-busy");
    await ready(page);
    expect(await when(card(page, cj(0)))).toBe("Tomorrow, 09:00");
    expect(await when(card(page, cj(1)))).toBe("Tomorrow, 13:00");

    // The upper half of the 3rd row (the pin): the gap between it and q2.
    const third = await box(card(page, PIN));
    await drag(page, card(page, cj(0)), { x: third.x + third.width / 2, y: third.y + 8 });
    await expect(page.locator("[data-drop-target][data-active]")).toHaveCount(1);
    await expect(card(page, cj(0))).toHaveAttribute("data-dragging", "");
    await page.mouse.up();

    await expect(toast(page)).toContainText("Moved to @codingjourney, Tomorrow, 13:00.");
    await expect(page.locator("[data-drop-targets]")).toHaveCount(0);
    await expect(card(page, cj(1))).toHaveAttribute("aria-label", /, Tomorrow, 09:00$/);
    await expect(card(page, cj(0))).toHaveAttribute("aria-label", /, Tomorrow, 13:00$/);
    await expect(card(page, PIN)).toHaveAttribute("aria-label", /, Tomorrow, 19:00$/);
    // The drop didn't open the drawer.
    await expect(drawer(page)).toHaveCount(0);

    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect(toast(page)).toContainText("Move undone.");
    await expect(card(page, cj(0))).toHaveAttribute("aria-label", /, Tomorrow, 09:00$/);
    await expect(card(page, cj(1))).toHaveAttribute("aria-label", /, Tomorrow, 13:00$/);
  });

  test("dragging a card to @trip.app's open slot moves it to that account", async ({
    page,
    loadScenario,
  }) => {
    await loadScenario("canvas-busy");
    await ready(page);
    const trip = page.locator('[data-column="trip.app"]');
    const open = trip.locator('[data-kind="open"]').first();
    const slot = await when(card(page, cj(1)));
    const o = await box(open);

    await drag(page, card(page, cj(0)), { x: o.x + o.width / 2, y: o.y + o.height / 2 });
    await page.mouse.up();

    await expect(toast(page)).toContainText(/^Moved to @trip\.app, .+, 12:00\.Undo$/);
    await expect(trip.locator(`[data-post="${cj(0)}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-column="codingjourney"] [data-post="${cj(0)}"]`)).toHaveCount(
      0,
    );
    // @codingjourney's queue moved up.
    expect(slot).toBe("Tomorrow, 13:00");
    await expect(card(page, cj(1))).toHaveAttribute("aria-label", /, Tomorrow, 09:00$/);
  });

  test("Escape or dropping outside cancels; a short click still opens the drawer", async ({
    page,
    loadScenario,
  }) => {
    await loadScenario("canvas-busy");
    await ready(page);
    const before = await box(card(page, cj(0)));

    await drag(page, card(page, cj(0)), { x: before.x + 200, y: before.y - 150 });
    await expect(page.locator("[data-drop-targets]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-drop-targets]")).toHaveCount(0);
    await page.mouse.up();

    // Far below the now line: no target.
    await drag(page, card(page, cj(0)), { x: before.x + 20, y: before.y + 300 });
    await page.mouse.up();
    await expect(toast(page)).toHaveCount(0);
    expect(await box(card(page, cj(0)))).toEqual(before);
    expect(await when(card(page, cj(0)))).toBe("Tomorrow, 09:00");

    await card(page, cj(0)).click();
    await expect(drawer(page)).toBeVisible();
  });

  test("panning still works when the drag starts on the background", async ({
    page,
    loadScenario,
  }) => {
    await loadScenario("canvas-busy");
    await ready(page);
    const world = page.locator("[data-canvas-world]");
    const before = await world.evaluate((el) => (el as HTMLElement).style.transform);
    const c = await box(card(page, cj(0)));
    // Left of the first column, above the now line.
    const x = c.x - 40;
    const y = c.y + c.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y + 60, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const after = await world.evaluate((el) => (el as HTMLElement).style.transform);
    expect(after).not.toBe(before);
    await expect(page.locator("[data-drop-targets]")).toHaveCount(0);
    expect((await box(card(page, cj(0)))).x).toBeCloseTo(c.x + 120, 0);
  });
});

/** Synthetic touch pointer events (one finger), dispatched like a browser would. */
async function touch(page: Page, type: string, x: number, y: number, target?: Locator) {
  const init = { pointerType: "touch", pointerId: 7, isPrimary: true, clientX: x, clientY: y };
  if (target) {
    await target.dispatchEvent(type, { ...init, bubbles: true, buttons: 1 });
    return;
  }
  await page.evaluate(
    ([t, i]) => {
      window.dispatchEvent(new PointerEvent(t, { ...i, bubbles: true, buttons: 1 }));
    },
    [type, init] as const,
  );
}

test("touch: holding a card picks it up; a finger that moves at once pans", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("canvas-busy");
  await expect(stage(page)).toHaveAttribute("data-ready", "true");
  const c = await box(card(page, cj(0)));
  const x = c.x + c.width / 2;
  const y = c.y + c.height / 2;

  // Moves straight away: a pan, not a card drag.
  const world = page.locator("[data-canvas-world]");
  const before = await world.evaluate((el) => (el as HTMLElement).style.transform);
  await touch(page, "pointerdown", x, y, card(page, cj(0)));
  await touch(page, "pointermove", x + 30, y + 40);
  await touch(page, "pointermove", x + 60, y + 80);
  await expect(page.locator("[data-drop-targets]")).toHaveCount(0);
  await touch(page, "pointerup", x + 60, y + 80);
  await settle(page);
  expect(await world.evaluate((el) => (el as HTMLElement).style.transform)).not.toBe(before);

  // Held for the hold time: picked up.
  const d = await box(card(page, cj(0)));
  const dx = d.x + d.width / 2;
  const dy = d.y + d.height / 2;
  await touch(page, "pointerdown", dx, dy, card(page, cj(0)));
  await page.waitForTimeout(250);
  await expect(page.locator("[data-drop-targets]")).toHaveCount(1);
  await touch(page, "pointercancel", dx, dy);
  await expect(page.locator("[data-drop-targets]")).toHaveCount(0);
});

test("Move to… in the post drawer moves the post with the keyboard", async ({
  page,
  loadScenario,
}) => {
  await loadScenario("canvas-busy");
  await expect(stage(page)).toHaveAttribute("data-ready", "true");
  await card(page, cj(0)).focus();
  await page.keyboard.press("Enter");
  await expect(drawer(page)).toBeVisible();

  await drawer(page).getByRole("button", { name: "Move to…" }).click();
  const form = drawer(page).getByRole("group", { name: "Move to" });
  await form.getByLabel("Account").selectOption({ label: "@trip.app" });
  await form.getByLabel("Position").selectOption({ label: "Last in the queue" });
  await form.getByRole("button", { name: "Move", exact: true }).click();

  await expect(toast(page)).toContainText(/^Moved to @trip\.app, .+, 12:00\.Undo$/);
  await expect(page.locator(`[data-column="trip.app"] [data-post="${cj(0)}"]`)).toHaveCount(1);
  // The drawer follows the post to its new account.
  await expect(drawer(page)).toContainText("@trip.app");
});
