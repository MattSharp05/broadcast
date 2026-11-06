import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ContentError, queueContent } from "@/lib/db/posts";
import {
  VIDEOS_BUCKET,
  clearWorkspaceUploads,
  deletePublishedVideo,
  probeStoredVideo,
  signUploadUrl,
  signVideoUrl,
  uploadPaths,
} from "@/lib/db/videos";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { planQueue } from "@/lib/domain/queue";
import { getScenario } from "@/lib/scenarios";
import { loadScenario } from "@/lib/scenarios/load";
import {
  ALLOWED_EMAIL,
  OTHER_EMAIL,
  adminClient,
  anonClient,
  setAllowedEmail,
  signedInClient,
  type Db,
} from "./helpers";

// BC-14: the `videos` bucket and its policies, uploads through signed URLs, the server's own
// read of an upload, BC-16's delete-after-publish against real Storage, and queueContent.

const admin = adminClient();
const SANDBOX = WORKSPACE_IDS.sandbox;
const NOW = new Date("2026-11-05T22:14:00Z");
const REEL = new Uint8Array(
  readFileSync(join(process.cwd(), "tests/fixtures/video/reel-9x16.mp4")),
);
const SQUARE = new Uint8Array(
  readFileSync(join(process.cwd(), "tests/fixtures/video/portrait-4x5.mp4")),
);

async function put(url: string, body: Uint8Array, type = "video/mp4") {
  return fetch(url, { method: "PUT", body, headers: { "content-type": type } });
}

async function exists(path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const { data } = await admin.storage
    .from(VIDEOS_BUCKET)
    .list(path.slice(0, slash), { search: path.slice(slash + 1) });
  return (data ?? []).some((f) => f.name === path.slice(slash + 1));
}

let owner: Db;

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("missing row");
  return value;
}

beforeAll(async () => {
  await setAllowedEmail(ALLOWED_EMAIL);
  owner = await signedInClient(ALLOWED_EMAIL);
});

afterAll(async () => {
  await clearWorkspaceUploads(admin, SANDBOX);
});

describe("videos bucket", () => {
  it("exists, private, with the Reels limits", async () => {
    const { data, error } = await admin.storage.getBucket(VIDEOS_BUCKET);
    expect(error).toBeNull();
    expect(data).toMatchObject({ public: false, file_size_limit: 52428800 });
    expect(data?.allowed_mime_types).toEqual(["video/mp4", "video/quicktime", "image/jpeg"]);
  });

  it("the owner can sign upload URLs; anon and other users can't", async () => {
    const path = uploadPaths(SANDBOX, crypto.randomUUID(), "video/mp4").video;
    await expect(signUploadUrl(owner, path)).resolves.toMatch(/token=/);
    await expect(signUploadUrl(anonClient(), path)).rejects.toThrow();
    const other = await signedInClient(OTHER_EMAIL);
    await expect(signUploadUrl(other, path)).rejects.toThrow();
  });

  it("a signed upload URL takes the file; the server reads it back by Range", async () => {
    const path = uploadPaths(SANDBOX, crypto.randomUUID(), "video/mp4").video;
    const res = await put(await signUploadUrl(owner, path), REEL);
    expect(res.status).toBe(200);
    const probed = await probeStoredVideo(owner, path);
    expect(probed).toEqual({
      bytes: REEL.length,
      info: { durationS: 4, width: 1080, height: 1920, codec: "avc1" },
    });
    // Others still can't read it.
    const other = await signedInClient(OTHER_EMAIL);
    await expect(signVideoUrl(other, path)).rejects.toThrow();
  });

  it("rejects other file types", async () => {
    const path = `${SANDBOX}/videos/${crypto.randomUUID()}.mp4`;
    const res = await put(await signUploadUrl(owner, path), REEL, "text/plain");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("probing a missing upload says so", async () => {
    await expect(probeStoredVideo(owner, `${SANDBOX}/videos/missing.mp4`)).rejects.toThrow(
      /wasn't found/,
    );
  });
});

describe("delete after publish (BC-16) with the bucket in place", () => {
  it("deletes the video file and marks the media deleted; keeps the thumbnail", async () => {
    const scenario = getScenario("empty");
    if (!scenario) throw new Error("no empty scenario");
    await loadScenario(admin, scenario, { fixedNow: NOW });
    const paths = uploadPaths(SANDBOX, crypto.randomUUID(), "video/mp4");
    await put(await signUploadUrl(admin, paths.video), REEL);
    await put(
      await signUploadUrl(admin, paths.thumbnail),
      new Uint8Array([0xff, 0xd8, 0xff]),
      "image/jpeg",
    );
    const brand = await admin
      .from("brands")
      .insert({ workspace_id: SANDBOX, name: "B" })
      .select("id")
      .single();
    const account = await admin
      .from("social_accounts")
      .insert({
        workspace_id: SANDBOX,
        brand_id: must(brand.data).id,
        platform: "fake",
        handle: "del",
      })
      .select("id")
      .single();
    const media = await admin
      .from("media_assets")
      .insert({ workspace_id: SANDBOX, storage_path: paths.video, thumbnail_path: paths.thumbnail })
      .select("id")
      .single();
    const post = await admin
      .from("posts")
      .insert({
        workspace_id: SANDBOX,
        account_id: must(account.data).id,
        media_id: must(media.data).id,
        status: "published",
        published_at: NOW.toISOString(),
      })
      .select("id")
      .single();
    expect(await exists(paths.video)).toBe(true);

    const result = await deletePublishedVideo(admin, {
      workspaceId: SANDBOX,
      mediaId: must(media.data).id,
      postId: must(post.data).id,
      storagePath: paths.video,
    });
    expect(result).toBe("deleted");
    expect(await exists(paths.video)).toBe(false);
    expect(await exists(paths.thumbnail)).toBe(true);
    const row = await admin
      .from("media_assets")
      .select("deleted_at")
      .eq("id", must(media.data).id)
      .single();
    expect(row.data?.deleted_at).not.toBeNull();
  });
});

describe("queueContent", () => {
  const scenario = getScenario("add-content");
  if (!scenario) throw new Error("no add-content scenario");
  let accounts: Record<string, { id: string; slots: string[] } | undefined> = {};
  const acc = (handle: string) => must(accounts[handle]);

  beforeEach(async () => {
    await loadScenario(admin, scenario, { fixedNow: NOW });
    const res = await admin
      .from("social_accounts")
      .select("id, handle, slots")
      .eq("workspace_id", SANDBOX);
    accounts = Object.fromEntries((res.data ?? []).map((a) => [a.handle, a]));
  });

  async function upload() {
    const paths = uploadPaths(SANDBOX, crypto.randomUUID(), "video/mp4");
    await put(await signUploadUrl(owner, paths.video), REEL);
    return {
      storagePath: paths.video,
      thumbnailPath: null,
      durationS: 4,
      width: 1080,
      height: 1920,
      bytes: REEL.length,
    };
  }

  async function postsOf(handle: string) {
    const res = await admin
      .from("posts")
      .select("id, timing, queue_position, scheduled_at, status, caption")
      .eq("workspace_id", SANDBOX)
      .eq("account_id", acc(handle).id);
    return res.data ?? [];
  }

  it("queues on two accounts: each post's scheduled_at is what planQueue says", async () => {
    const out = await queueContent(owner, {
      workspaceId: SANDBOX,
      timezone: "Europe/London",
      now: NOW,
      media: await upload(),
      caption: "Day 42",
      accountIds: [acc("codingjourney").id, acc("trip.app").id],
      timing: { kind: "queue" },
    });
    expect(out.posts).toHaveLength(2);
    for (const handle of ["codingjourney", "trip.app"]) {
      const rows = await postsOf(handle);
      const planned = planQueue({
        slots: acc(handle).slots,
        timezone: "Europe/London",
        now: NOW,
        posts: rows.map((r) => ({
          id: r.id,
          timing: r.timing,
          queuePosition: r.queue_position,
          scheduledAt: r.scheduled_at ? new Date(r.scheduled_at) : null,
          status: r.status,
        })),
      });
      for (const p of planned) {
        const row = rows.find((r) => r.id === p.id);
        expect(row?.scheduled_at && new Date(row.scheduled_at).toISOString()).toBe(
          p.scheduledAt?.toISOString(),
        );
      }
      const mine = rows.find((r) => r.caption === "Day 42");
      expect(mine).toMatchObject({ timing: "queue", status: "queued" });
      expect(mine?.queue_position).toBe(Math.max(...rows.map((r) => r.queue_position ?? -1)));
    }
    // @codingjourney had 2 queued (Fri 09:00, 13:00): the new one takes 19:00. @trip.app: Fri 12:00.
    expect(out.posts.map((p) => p.scheduledAt?.toISOString())).toEqual([
      "2026-11-06T19:00:00.000Z",
      "2026-11-06T12:00:00.000Z",
    ]);
  });

  it("pins at a time; the queued posts after it keep their times", async () => {
    const before = await postsOf("codingjourney");
    const at = new Date("2026-11-06T11:30:00Z");
    const out = await queueContent(owner, {
      workspaceId: SANDBOX,
      timezone: "Europe/London",
      now: NOW,
      media: await upload(),
      caption: "Pinned",
      accountIds: [acc("codingjourney").id],
      timing: { kind: "pinned", at },
    });
    expect(out.posts[0]?.scheduledAt?.toISOString()).toBe(at.toISOString());
    const after = await postsOf("codingjourney");
    for (const b of before) {
      expect(after.find((a) => a.id === b.id)?.scheduled_at).toBe(b.scheduled_at);
    }
    expect(after.find((a) => a.caption === "Pinned")).toMatchObject({
      timing: "pinned",
      queue_position: null,
    });
  });

  it("paused accounts get paused posts; no slots means no time", async () => {
    const out = await queueContent(owner, {
      workspaceId: SANDBOX,
      timezone: "Europe/London",
      now: NOW,
      media: await upload(),
      caption: "",
      accountIds: [acc("tri.weekly").id, acc("driftship").id],
      timing: { kind: "queue" },
    });
    expect(out.posts.map((p) => [p.handle, p.status, p.scheduledAt])).toEqual([
      ["tri.weekly", "paused", new Date("2026-11-07T07:00:00Z")],
      ["driftship", "queued", null],
    ]);
  });

  it("refuses past pins, unknown accounts and other workspaces' paths, leaving nothing", async () => {
    const media = await upload();
    const base = {
      workspaceId: SANDBOX,
      timezone: "Europe/London",
      now: NOW,
      media,
      caption: "x",
      accountIds: [acc("trip.app").id],
      timing: { kind: "queue" as const },
    };
    await expect(
      queueContent(owner, {
        ...base,
        timing: { kind: "pinned", at: new Date("2026-11-05T22:00:00Z") },
      }),
    ).rejects.toMatchObject({ code: "pinned_past" });
    await expect(
      queueContent(owner, { ...base, accountIds: [crypto.randomUUID()] }),
    ).rejects.toBeInstanceOf(ContentError);
    await expect(
      queueContent(owner, {
        ...base,
        media: { ...media, storagePath: `${WORKSPACE_IDS.live}/videos/x.mp4` },
      }),
    ).rejects.toMatchObject({ code: "bad_path" });
    const count = await admin
      .from("media_assets")
      .select("*", { count: "exact", head: true })
      .eq("storage_path", media.storagePath);
    expect(count.count).toBe(0);
  });

  it("the server's read of a 4:5 upload fails the Reels checks", async () => {
    const path = uploadPaths(SANDBOX, crypto.randomUUID(), "video/mp4").video;
    await put(await signUploadUrl(owner, path), SQUARE);
    const { info } = await probeStoredVideo(owner, path);
    expect(info).toMatchObject({ width: 1080, height: 1350 });
  });
});
