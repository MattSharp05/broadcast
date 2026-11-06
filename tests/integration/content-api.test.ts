import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as queuePost } from "@/app/api/content/route";
import { POST as uploadPost } from "@/app/api/content/uploads/route";
import { hashApiKey } from "@/lib/auth/api-keys";
import { createApiKey } from "@/lib/db/api-keys";
import { queueContent } from "@/lib/db/posts";
import { VIDEOS_BUCKET, clearWorkspaceUploads } from "@/lib/db/videos";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { UPLOADS_PER_HOUR } from "@/lib/domain/content-api";
import { checkVideo } from "@/lib/media/checks";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import { adminClient } from "./helpers";

// BC-17: the content API against the local stack: key auth (missing, wrong, revoked), workspace
// scoping (a Sandbox key can't reach Live), the two-step upload, the server's own check of the
// file, one queue per upload, the rate limit, and that nothing is published.

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const LIVE = WORKSPACE_IDS.live;
const NOW = new Date("2026-11-05T22:14:00Z");
const HANDLE = "example.account";
const LIVE_HANDLE = "bc17.live.only";
const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures/video", name)));

function call(
  handler: (r: NextRequest) => Promise<Response>,
  path: string,
  body: unknown,
  key: string | null,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const askUpload = (key: string | null, body: unknown = { file_name: "render.mp4", bytes: 1000 }) =>
  call(uploadPost, "/api/content/uploads", body, key);
const queue = (key: string | null, body: unknown) => call(queuePost, "/api/content", body, key);

/** Steps 1 and 2: an upload URL, and the file PUT to it. */
async function upload(key: string, name = "reel-9x16.mp4"): Promise<string> {
  const file = fixture(name);
  const res = await askUpload(key, { file_name: name, bytes: file.length });
  expect(res.status).toBe(201);
  const ticket = (await res.json()) as { upload_id: string; upload_url: string };
  const put = await fetch(ticket.upload_url, {
    method: "PUT",
    body: file,
    headers: { "content-type": "video/mp4" },
  });
  expect(put.status).toBe(200);
  return ticket.upload_id;
}

async function fakeContainers(): Promise<number> {
  const { count } = await admin
    .from("fake_containers")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", SANDBOX);
  return count ?? 0;
}

let sandboxKey: string;
let liveKey: string;
let liveKeyId: string;
let liveBrandId: string;

beforeAll(async () => {
  const brand = await admin
    .from("brands")
    .insert({ workspace_id: LIVE, name: "BC-17 test brand" })
    .select("id")
    .single();
  liveBrandId = brand.data?.id ?? "";
  await admin.from("social_accounts").insert({
    workspace_id: LIVE,
    brand_id: liveBrandId,
    platform: "fake",
    handle: LIVE_HANDLE,
    slots: ["09:00"],
    status: "ready",
  });
  const live = await createApiKey(admin, { kind: "live", name: "BC-17 live test" });
  liveKey = live.key;
  liveKeyId = live.id;
});

afterAll(async () => {
  await admin.from("api_keys").delete().eq("id", liveKeyId);
  await admin.from("brands").delete().eq("id", liveBrandId);
  await clearWorkspaceUploads(admin, SANDBOX);
});

beforeEach(async () => {
  const scenario = getScenario("empty");
  if (!scenario) throw new Error("no empty scenario");
  await loadScenario(admin, scenario, { fixedNow: NOW });
  sandboxKey = (await createApiKey(admin, { kind: "sandbox", name: "BC-17 test" })).key;
});

describe("API keys", () => {
  it("are stored as a SHA-256 hash only", async () => {
    const { data } = await admin
      .from("api_keys")
      .select("key_hash")
      .eq("workspace_id", SANDBOX)
      .single();
    expect(data?.key_hash).toBe(hashApiKey(sandboxKey));
    expect(data?.key_hash).not.toContain(sandboxKey.slice(11));
  });

  it.each([
    ["no header", null],
    ["a malformed key", "nope"],
    ["an unknown key", "bc_sandbox_" + "A".repeat(43)],
    ["a key naming the wrong workspace", null],
  ])("401 for %s, on both endpoints", async (label, key) => {
    const sent = label.includes("wrong") ? sandboxKey.replace("bc_sandbox_", "bc_live_") : key;
    for (const res of [await askUpload(sent), await queue(sent, {})]) {
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(await res.json()).toMatchObject({ error: "unauthorized" });
    }
  });

  it("a revoked key stops working at once (401), and use is recorded until then", async () => {
    expect((await askUpload(sandboxKey)).status).toBe(201);
    const used = await admin
      .from("api_keys")
      .select("last_used_at")
      .eq("workspace_id", SANDBOX)
      .single();
    expect(used.data?.last_used_at).not.toBeNull();

    await admin
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("workspace_id", SANDBOX);
    expect((await askUpload(sandboxKey)).status).toBe(401);
  });

  it("responses never echo the key", async () => {
    for (const res of [await askUpload(sandboxKey), await queue(sandboxKey, {})]) {
      expect(await res.text()).not.toContain(sandboxKey);
    }
  });
});

describe("POST /api/content/uploads", () => {
  it("returns a signed URL under the key's workspace, without the storage path", async () => {
    const res = await askUpload(sandboxKey);
    const body = (await res.json()) as Record<string, string>;
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ method: "PUT", content_type: "video/mp4" });
    expect(body.upload_url).toContain(`/upload/sign/${VIDEOS_BUCKET}/${SANDBOX}/videos/`);
    expect(new Date(body.expires_at ?? "").getTime()).toBeGreaterThan(Date.now());
    const row = await admin
      .from("content_uploads")
      .select("storage_path, workspace_id")
      .eq("id", body.upload_id ?? "")
      .single();
    expect(row.data).toEqual({
      storage_path: `${SANDBOX}/videos/${body.upload_id}.mp4`,
      workspace_id: SANDBOX,
    });
  });

  it("checks type and size first, with BC-14's messages (422)", async () => {
    const res = await askUpload(sandboxKey, { file_name: "clip.avi", bytes: 60 * 1024 * 1024 });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "invalid_file",
      message:
        "This file is a .avi file. Reels must be an MP4 or MOV video. This video is 60 MB. Reels can be up to 50 MB.",
    });
  });

  it("400 for a body that isn't what it expects", async () => {
    expect((await askUpload(sandboxKey, "not json")).status).toBe(400);
    expect((await askUpload(sandboxKey, { file_name: "a.mp4" })).status).toBe(400);
  });

  it(`allows ${UPLOADS_PER_HOUR} uploads per key per hour (429 after)`, async () => {
    const key = await admin.from("api_keys").select("id").eq("workspace_id", SANDBOX).single();
    const rows = Array.from({ length: UPLOADS_PER_HOUR }, () => {
      const id = crypto.randomUUID();
      return {
        id,
        workspace_id: SANDBOX,
        api_key_id: key.data?.id ?? "",
        storage_path: `${SANDBOX}/videos/${id}.mp4`,
        file_name: "x.mp4",
        content_type: "video/mp4",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      };
    });
    expect((await admin.from("content_uploads").insert(rows)).error).toBeNull();
    const res = await askUpload(sandboxKey);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("600");
  });
});

describe("POST /api/content", () => {
  it("queues the upload on the account's next slot, publishing nothing", async () => {
    const containers = await fakeContainers();
    const uploadId = await upload(sandboxKey);
    const res = await queue(sandboxKey, {
      upload_id: uploadId,
      caption: "Day 42: from the API",
      accounts: [`@${HANDLE}`],
      timing: "next_slot",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      media_id: string;
      message: string;
      posts: { id: string; handle: string; status: string; scheduled_at: string }[];
    };
    // The empty scenario's account posts at 09:00 and 18:00 London; it's Thu 22:14.
    expect(body.posts).toEqual([
      expect.objectContaining({
        handle: HANDLE,
        status: "queued",
        scheduled_at: "2026-11-06T09:00:00.000Z",
      }),
    ]);
    expect(body.message).toBe("Added to 1 queue. First post Tomorrow, 09:00.");

    const post = await admin
      .from("posts")
      .select("status, caption, timing, queue_position, media_assets(width, height, duration_s)")
      .eq("id", body.posts[0]?.id ?? "")
      .single();
    expect(post.data).toMatchObject({
      status: "queued",
      caption: "Day 42: from the API",
      timing: "queue",
      queue_position: 0,
      media_assets: { width: 1080, height: 1920 },
    });
    expect(await fakeContainers()).toBe(containers);
  });

  it("pins to a local time in the workspace timezone", async () => {
    const uploadId = await upload(sandboxKey);
    const res = await queue(sandboxKey, {
      upload_id: uploadId,
      accounts: [HANDLE],
      timing: { pinned_at: "2026-11-08T12:00" },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { posts: { scheduled_at: string }[] };
    expect(body.posts[0]?.scheduled_at).toBe("2026-11-08T12:00:00.000Z");
  });

  it("queues one upload only once (409 the second time)", async () => {
    const uploadId = await upload(sandboxKey);
    const send = () => queue(sandboxKey, { upload_id: uploadId, accounts: [HANDLE] });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const { count } = await admin
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", SANDBOX);
    expect(count).toBe(1);
  });

  it("a Sandbox key can't target a Live account (403), and the upload stays usable", async () => {
    const uploadId = await upload(sandboxKey);
    const res = await queue(sandboxKey, { upload_id: uploadId, accounts: [LIVE_HANDLE] });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "wrong_workspace",
      message: `@${LIVE_HANDLE} is in the Live workspace. This key can only queue to Sandbox accounts.`,
    });
    const { count } = await admin
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", LIVE);
    expect(count).toBe(0);
    expect((await queue(sandboxKey, { upload_id: uploadId, accounts: [HANDLE] })).status).toBe(201);
  });

  it("a Live key can't use a Sandbox upload or account", async () => {
    const uploadId = await upload(sandboxKey);
    const sandboxAccount = await queue(liveKey, { upload_id: uploadId, accounts: [HANDLE] });
    expect(sandboxAccount.status).toBe(403);
    const sandboxUpload = await queue(liveKey, { upload_id: uploadId, accounts: [LIVE_HANDLE] });
    expect(sandboxUpload.status).toBe(404);
    expect(await sandboxUpload.json()).toMatchObject({ error: "upload_not_found" });
  });

  it("422 for an account that doesn't exist anywhere", async () => {
    const uploadId = await upload(sandboxKey);
    const res = await queue(sandboxKey, { upload_id: uploadId, accounts: ["nobody.here"] });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "unknown_account",
      message: "No account @nobody.here in this workspace.",
    });
  });

  it("refuses a 4:5 video with BC-14's message and removes the file", async () => {
    const uploadId = await upload(sandboxKey, "portrait-4x5.mp4");
    const res = await queue(sandboxKey, { upload_id: uploadId, accounts: [HANDLE] });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_video");
    const expected = checkVideo({ width: 1080, height: 1350, durationS: 4, codec: "avc1" })[0];
    expect(body.message).toBe(expected?.message);
    const { data } = await admin.storage
      .from(VIDEOS_BUCKET)
      .list(`${SANDBOX}/videos`, { search: uploadId });
    expect(data ?? []).toHaveLength(0);
  });

  it("409 while the file hasn't been PUT yet; the same upload works afterwards", async () => {
    const res = await askUpload(sandboxKey, { file_name: "reel.mp4", bytes: 1000 });
    const ticket = (await res.json()) as { upload_id: string; upload_url: string };
    const early = await queue(sandboxKey, { upload_id: ticket.upload_id, accounts: [HANDLE] });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: "upload_missing" });
    await fetch(ticket.upload_url, {
      method: "PUT",
      body: fixture("reel-9x16.mp4"),
      headers: { "content-type": "video/mp4" },
    });
    const later = await queue(sandboxKey, { upload_id: ticket.upload_id, accounts: [HANDLE] });
    expect(later.status).toBe(201);
  });

  it("an unknown upload id is 404, a malformed one 400", async () => {
    const unknown = await queue(sandboxKey, {
      upload_id: crypto.randomUUID(),
      accounts: [HANDLE],
    });
    expect(unknown.status).toBe(404);
    const traversal = await queue(sandboxKey, { upload_id: "../../x", accounts: [HANDLE] });
    expect(traversal.status).toBe(400);
  });
});

describe("queue positions", () => {
  it("two adds racing on one account get different positions", async () => {
    const account = await admin
      .from("social_accounts")
      .select("id")
      .eq("workspace_id", SANDBOX)
      .single();
    const add = (n: number) =>
      queueContent(admin, {
        workspaceId: SANDBOX,
        timezone: "Europe/London",
        now: NOW,
        media: {
          storagePath: `${SANDBOX}/videos/${crypto.randomUUID()}.mp4`,
          thumbnailPath: null,
          durationS: 10,
          width: 1080,
          height: 1920,
          bytes: 1000 + n,
        },
        caption: `Race ${n}`,
        accountIds: [account.data?.id ?? ""],
        timing: { kind: "queue" },
      });
    await Promise.all([add(1), add(2), add(3), add(4)]);
    const { data } = await admin
      .from("posts")
      .select("queue_position")
      .eq("workspace_id", SANDBOX)
      .order("queue_position");
    expect(data?.map((p) => p.queue_position)).toEqual([0, 1, 2, 3]);
  });
});
