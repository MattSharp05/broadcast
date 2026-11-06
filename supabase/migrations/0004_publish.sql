-- Publishing Reels (BC-16): when a post's container was made, and its stats rows once published.

-- When the post's current container was created. If a publish answer is lost, the provider looks
-- for the post among the account's recent media no older than this (src/lib/providers/instagram.ts).
alter table public.posts
  add column container_created_at timestamptz;

-- Stats snapshots are due at +1h, +6h, +24h, +48h and +7d after publishing (docs/TDD.md → Stats).
-- Created in the same transaction that marks the post published, so they can't be lost between
-- two writes; BC-21's tick step fills them in. Scenario seeds insert published posts directly
-- (not an update) and bring their own rows.
create function public.queue_post_metrics() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    insert into public.post_metrics (workspace_id, post_id, stat_offset, due_at)
    select new.workspace_id, new.id, o.stat_offset, coalesce(new.published_at, now()) + o.after
    from (values
      ('1h'::public.stat_offset, interval '1 hour'),
      ('6h', interval '6 hours'),
      ('24h', interval '24 hours'),
      ('48h', interval '48 hours'),
      ('7d', interval '7 days')
    ) as o (stat_offset, after)
    on conflict (post_id, stat_offset) do nothing;
  end if;
  return new;
end;
$$;

create trigger posts_queue_metrics after update of status on public.posts
  for each row execute function public.queue_post_metrics();
