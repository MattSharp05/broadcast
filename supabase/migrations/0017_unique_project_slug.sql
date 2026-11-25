-- One video per video-editor project in a workspace (BC-44): two imports of the same project at
-- once can't both create one. Pipeline slugs end in the production id, so they never collide.
create unique index productions_project_slug_idx on public.productions (workspace_id, project_slug)
  where project_slug is not null;
