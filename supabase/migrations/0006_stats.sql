-- Stats collection (BC-21): the scheduler's stats step fills in post_metrics rows (queued by
-- 0004_publish.sql) and writes each account's follower count once a day.

-- A snapshot that came due while the scheduler was down and was never taken: one insights call
-- gives today's numbers, which go to the latest due offset only (src/lib/domain/stats-schedule.ts).
-- A missed row has taken_at set and no numbers.
alter table public.post_metrics
  add column missed boolean not null default false;

-- claim_work gains kind 'stats': published posts with a stats snapshot due (by the workspace's
-- clock), on a ready account, oldest due first. It leases the post row (claimed_until /
-- claim_token), the same columns publishing uses; a published post is never claimed for
-- publishing, so the two kinds can't collide. A step that fails leaves the lease running as its
-- back-off (claimed_until in the future, claim_token cleared).
create or replace function public.claim_work(
  p_kind text,
  p_limit integer,
  p_platforms public.platform[],
  p_workspace_ids uuid[] default null,
  p_lease_seconds integer default 120
) returns table (post_id uuid, workspace_id uuid, claim_token uuid)
language plpgsql
set search_path = ''
as $$
begin
  if p_kind = 'publish' then
    return query
    with due as (
      select p.id
      from public.posts p
      join public.social_accounts a on a.id = p.account_id and a.workspace_id = p.workspace_id
      join public.settings s on s.workspace_id = p.workspace_id
      where a.platform = any (p_platforms)
        and (p_workspace_ids is null or p.workspace_id = any (p_workspace_ids))
        and (p.claimed_until is null or p.claimed_until < now())
        and (
          (p.status = 'queued'
            and p.scheduled_at <= coalesce(s.clock_override, now())
            and (p.next_attempt_at is null or p.next_attempt_at <= coalesce(s.clock_override, now())))
          or
          (p.status = 'publishing'
            and coalesce(p.next_attempt_at, p.scheduled_at) <= coalesce(s.clock_override, now()))
        )
      order by coalesce(p.next_attempt_at, p.scheduled_at), p.id
      limit greatest(p_limit, 0)
      for update of p skip locked
    )
    update public.posts p
    set claimed_until = now() + make_interval(secs => p_lease_seconds),
        claim_token = gen_random_uuid()
    from due
    where p.id = due.id
    returning p.id, p.workspace_id, p.claim_token;

  elsif p_kind = 'stats' then
    return query
    with due as (
      select p.id
      from public.posts p
      join public.social_accounts a on a.id = p.account_id and a.workspace_id = p.workspace_id
      join public.settings s on s.workspace_id = p.workspace_id
      join lateral (
        select min(m.due_at) as first_due
        from public.post_metrics m
        where m.post_id = p.id
          and m.workspace_id = p.workspace_id
          and m.taken_at is null
          and m.due_at <= coalesce(s.clock_override, now())
      ) d on d.first_due is not null
      where p.status = 'published'
        and a.status = 'ready'
        and a.platform = any (p_platforms)
        and (p_workspace_ids is null or p.workspace_id = any (p_workspace_ids))
        and (p.claimed_until is null or p.claimed_until < now())
      order by d.first_due, p.id
      limit greatest(p_limit, 0)
      for update of p skip locked
    )
    update public.posts p
    set claimed_until = now() + make_interval(secs => p_lease_seconds),
        claim_token = gen_random_uuid()
    from due
    where p.id = due.id
    returning p.id, p.workspace_id, p.claim_token;

  else
    raise exception 'claim_work: unknown kind %', p_kind;
  end if;
end;
$$;
