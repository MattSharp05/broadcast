-- BC-22 round 2: moving a post (drag on the canvas, "Move to…", Undo) in one transaction.
--
-- `queue_position` is unique per account (posts_account_queue_position_key, 0007_api_keys.sql).
-- A move can give the moved post a position another post holds until it is renumbered, and the
-- renumbered posts can swap positions among themselves, so writing the rows one at a time collides
-- with the index. move_post applies every position change of a move together, in two phases:
--   1. park: every row the move changes gets queue_position null (the index skips nulls);
--   2. write the final positions (and the moved post's account, status, timing and time).
-- Positions other posts keep (published, removed, pinned, …) are left out by the caller
-- (positionChanges in src/lib/domain/move.ts); if one is taken meanwhile (a racing add), the
-- index refuses it and the whole move is undone.
--
-- Guards (BC-18): the moved post and every renumbered post must still wait (queued or paused) and
-- not be claimed by a tick (claimed_until is a real-time lease), else nothing changes. Scoping:
-- security invoker, so RLS applies to the caller as for any other query; every statement also
-- filters on p_workspace_id, and the target account must belong to that workspace.
--
-- Returns 'ok', 'not_editable' (the moved post can't move) or 'queue_changed' (a renumbered post
-- or a position changed meanwhile).

create function public.move_post(
  p_workspace_id uuid,
  p_post_id uuid,
  p_account_id uuid,
  p_status public.post_status,
  p_timing public.post_timing,
  p_queue_position integer default null,
  p_scheduled_at timestamptz default null,
  p_renumber jsonb default '[]'::jsonb
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_locked integer;
begin
  if p_status not in ('queued', 'paused') then
    raise exception 'move_post: a moved post waits (queued or paused), not %', p_status;
  end if;

  if not exists (
    select 1 from public.social_accounts a
    where a.id = p_account_id and a.workspace_id = p_workspace_id
  ) then
    return 'not_editable';
  end if;

  -- The moved post: still waiting and unclaimed. Locked until the move commits, so a tick's claim
  -- waits and then sees the moved row.
  perform 1 from public.posts p
  where p.id = p_post_id
    and p.workspace_id = p_workspace_id
    and p.status in ('queued', 'paused')
    and (p.claimed_until is null or p.claimed_until < now())
  for update;
  if not found then
    return 'not_editable';
  end if;

  -- The renumbered posts: the target account's waiting, unclaimed posts.
  select coalesce(array_agg(distinct (c ->> 'id')::uuid), '{}')
  into v_ids
  from jsonb_array_elements(p_renumber) c
  where (c ->> 'id')::uuid <> p_post_id;

  select count(*) into v_locked
  from (
    select 1 from public.posts p
    where p.id = any (v_ids)
      and p.workspace_id = p_workspace_id
      and p.account_id = p_account_id
      and p.status in ('queued', 'paused')
      and (p.claimed_until is null or p.claimed_until < now())
    for update
  ) locked;
  if v_locked <> coalesce(array_length(v_ids, 1), 0) then
    return 'queue_changed';
  end if;

  begin
    -- 1. Park.
    update public.posts p
    set queue_position = null
    where p.workspace_id = p_workspace_id
      and (p.id = p_post_id or p.id = any (v_ids))
      and p.queue_position is not null;

    -- 2. Final positions.
    update public.posts p
    set queue_position = c.queue_position
    from jsonb_to_recordset(p_renumber) as c (id uuid, queue_position integer)
    where p.id = c.id
      and p.id <> p_post_id
      and p.workspace_id = p_workspace_id;

    update public.posts p
    set account_id = p_account_id,
        status = p_status,
        timing = p_timing,
        queue_position = p_queue_position,
        scheduled_at = p_scheduled_at,
        next_attempt_at = null
    where p.id = p_post_id
      and p.workspace_id = p_workspace_id;
  exception
    when unique_violation then
      return 'queue_changed';
  end;

  return 'ok';
end;
$$;

revoke all on function public.move_post(uuid, uuid, uuid, public.post_status, public.post_timing, integer, timestamptz, jsonb)
  from public, anon;
grant execute on function public.move_post(uuid, uuid, uuid, public.post_status, public.post_timing, integer, timestamptz, jsonb)
  to authenticated, service_role;
