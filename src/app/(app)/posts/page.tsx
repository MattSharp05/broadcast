import type { Metadata } from "next";
import { PostsView } from "@/features/posts/PostsView";
import { nowFor } from "@/lib/clock";
import { loadPostsTable } from "@/lib/db/posts-table";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspace } from "@/lib/db/workspace";
import { parseQuery } from "@/lib/domain/posts-table";
import { tagPosts } from "./actions";

export const metadata: Metadata = {
  title: "Posts · Broadcast",
};

/**
 * The Posts tab: every post with what its video is made of and how it did. Filters, sort and the
 * stats-at choice come from the URL, so a filtered view can be bookmarked.
 */
export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseQuery(await searchParams);
  const db = await createServerSupabase();
  const workspace = await currentWorkspace();
  const rows = await loadPostsTable(db, workspace.id);
  return (
    <PostsView
      rows={rows}
      initialQuery={query}
      now={nowFor(workspace).toISOString()}
      timezone={workspace.timezone ?? "UTC"}
      tagPosts={tagPosts}
    />
  );
}
