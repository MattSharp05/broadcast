import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// BC-17: the content API end to end. A key made on /dev/api-keys, then
// scripts/broadcast-upload.mjs (what video-editor runs) uploads a fixture to the Sandbox and the
// card appears on the canvas. A revoked key is refused at once.

const run = promisify(execFile);
const SCRIPT = join(process.cwd(), "scripts/broadcast-upload.mjs");
const VIDEO = join(process.cwd(), "tests/fixtures/video/reel-9x16.mp4");
const HANDLE = "example.account";

async function createKey(page: Page, name: string): Promise<string> {
  await page.goto("/dev/api-keys");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Workspace").selectOption("sandbox");
  await page.getByRole("button", { name: "Create key" }).click();
  const field = page.getByTestId("new-api-key").getByLabel("New API key");
  await expect(field).toHaveValue(/^bc_sandbox_/);
  return field.inputValue();
}

async function upload(baseURL: string, key: string, caption: string) {
  try {
    const { stdout } = await run(
      process.execPath,
      [SCRIPT, "--file", VIDEO, "--caption", caption, "--accounts", HANDLE, "--json"],
      { env: { ...process.env, BROADCAST_URL: baseURL, BROADCAST_API_KEY: key } },
    );
    return { code: 0, out: JSON.parse(stdout) as Record<string, unknown> };
  } catch (err) {
    const e = err as { code: number; stdout: string };
    return { code: e.code, out: JSON.parse(e.stdout) as Record<string, unknown> };
  }
}

test.describe("empty", () => {
  test.beforeEach(async ({ loadScenario }) => {
    await loadScenario("empty");
  });

  test("the upload script queues a video and the card appears on the canvas", async ({
    page,
    baseURL,
  }) => {
    const key = await createKey(page, "video-editor");
    // The key is shown once: after a reload only its name is listed.
    await page.reload();
    await expect(page.getByTestId("new-api-key")).toHaveCount(0);
    await expect(page.locator('[data-key-name="video-editor"]')).toContainText("Sandbox");
    await expect(page.locator("body")).not.toContainText(key);

    const { code, out } = await upload(baseURL ?? "", key, "Day 42: queued by video-editor");
    expect(code).toBe(0);
    expect(out).toMatchObject({
      ok: true,
      posts: [{ handle: HANDLE, status: "queued", scheduled_at: "2026-11-06T09:00:00.000Z" }],
    });

    await page.goto("/workflow");
    const canvas = page.getByRole("region", { name: "Workflow canvas" });
    await expect(canvas).toHaveAttribute("data-ready", "true");
    await expect(
      page
        .locator(`[data-column="${HANDLE}"]`)
        .getByRole("button", { name: /^Day 42: queued by video-editor, Scheduled, / }),
    ).toHaveCount(1);

    // The key's use shows on the list.
    await page.goto("/dev/api-keys");
    await expect(page.locator('[data-key-name="video-editor"]')).not.toContainText("Never");
  });

  test("a revoked key is refused at once", async ({ page, baseURL }) => {
    const key = await createKey(page, "to revoke");
    await page.getByRole("button", { name: "Revoke to revoke" }).click();
    await expect(page.locator('[data-key-name="to revoke"]')).toContainText("Revoked");

    const { code, out } = await upload(baseURL ?? "", key, "Never queued");
    expect(code).toBe(1);
    expect(out).toMatchObject({ ok: false, status: 401, error: "unauthorized" });
  });
});
