import { beforeEach, describe, expect, it } from "vitest";
import { applyPostTag, loadPostsTable } from "@/lib/db/posts-table";
import { WORKSPACE_IDS } from "@/lib/db/workspaces";
import { countsAt, filterRows, emptyFilters } from "@/lib/domain/posts-table";
import { loadScenario } from "@/lib/scenarios/load";
import { postsTable, postsTableId } from "@/lib/scenarios/posts-table";
import { adminClient } from "./helpers";

const ws = WORKSPACE_IDS.sandbox;

describe("posts table (Sandbox scenario)", () => {
  const db = adminClient();
  beforeEach(async () => {
    await loadScenario(db, postsTable);
  });

  it("loads every post with its video, routine and stats", async () => {
    const rows = await loadPostsTable(db, ws);
    expect(rows).toHaveLength(6);
    const paris = rows.find((r) => r.id === postsTableId("paris"));
    expect(paris).toMatchObject({
      title: "Paris in 3 days for under €300",
      genre: "explainer",
      voice: "design-m2",
      tags: ["Trip"],
    });
    expect(paris?.voiceLabel).toContain("American male");
    expect(paris?.script).toHaveLength(3);
    if (!paris) throw new Error("no Paris post");
    expect(countsAt(paris, "latest")?.views).toBe(9100);
    expect(countsAt(paris, "24h")?.views).toBe(5400);
    const upload = rows.find((r) => r.id === postsTableId("upload"));
    expect(upload).toMatchObject({ productionId: null, title: "Desk setup tour", genre: null });
    expect(filterRows(rows, { ...emptyFilters(), tag: "trip" })).toHaveLength(4);
  });

  it("tags a video on the video and an upload on the post, and removes from both", async () => {
    const ids = [postsTableId("paris"), postsTableId("upload")];
    const added = await applyPostTag(db, ws, ids, "ads", "add");
    expect(added[postsTableId("paris")]).toEqual(["Trip", "ads"]);
    expect(added[postsTableId("upload")]).toEqual(["ads"]);
    const video = await db
      .from("productions")
      .select("tags")
      .eq("post_id", postsTableId("paris"))
      .single();
    expect(video.data?.tags).toEqual(["Trip", "ads"]);
    const post = await db.from("posts").select("tags").eq("id", postsTableId("upload")).single();
    expect(post.data?.tags).toEqual(["ads"]);

    // An existing tag keeps its spelling.
    const trip = await applyPostTag(db, ws, [postsTableId("upload")], "TRIP", "add");
    expect(trip[postsTableId("upload")]).toEqual(["ads", "Trip"]);

    const removed = await applyPostTag(db, ws, ids, "Ads", "remove");
    expect(removed[postsTableId("paris")]).toEqual(["Trip"]);
    expect(removed[postsTableId("upload")]).toEqual(["Trip"]);
  });
});
