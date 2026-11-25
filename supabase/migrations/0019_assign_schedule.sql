-- BC-43: assign and schedule from the Ready to post tab.

-- The fake provider records the cover URL the scheduler hands it, like Instagram's `cover_url`,
-- so the Sandbox can show and test it.
alter table public.fake_containers add column cover_url text;

-- Scheduling now starts from a version. A video whose render was approved before versions
-- existed (BC-36) and that isn't queued yet gets its render as v1, so it can still be scheduled.
insert into public.production_versions
  (workspace_id, production_id, number, media_id, duration_s, width, height, bytes, git_sha,
   made_by, intent, created_at)
select p.workspace_id, p.id, 1, m.id, m.duration_s, m.width, m.height, m.bytes,
  coalesce(nullif(trim(m.recipe ->> 'git_sha'), ''), 'unknown'), 'render',
  'The approved render (from before versions).', m.created_at
from public.productions p
join public.media_assets m on m.id = p.media_id and m.workspace_id = p.workspace_id
where p.post_id is null
  and m.deleted_at is null
  and not exists (select 1 from public.production_versions v where v.production_id = p.id);
