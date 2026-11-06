-- Scheduler tick (ADR 0002, BC-12): work claiming, the scheduler's heartbeat, and the pg_cron job
-- that calls POST <APP_URL>/api/cron/tick every minute.
--
-- The cron job needs two Vault secrets, which only exist in production:
--   broadcast_app_url      the app's public base URL, e.g. https://broadcast.example.com
--   broadcast_cron_secret  the same value as the app's CRON_SECRET env var
-- Until both are set, `schedule_tick()` does nothing, so this migration runs cleanly on a local
-- stack and in CI. Production set-up (SQL editor, once):
--   select vault.create_secret('https://<app>', 'broadcast_app_url');
--   select vault.create_secret('<CRON_SECRET>', 'broadcast_cron_secret');
--   select public.schedule_tick();
-- The job reads the secrets on every run, so rotating one is `vault.update_secret(…)` only.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ───────────────────────────── work claiming ─────────────────────────────

-- A claimed post is leased to one tick until claimed_until; claim_token says which. The tick
-- writes its result only while it holds the token, so a late, overlapping tick can't overwrite.
alter table public.posts
  add column claimed_until timestamptz,
  add column claim_token uuid;

-- Claims up to p_limit rows of due work of one kind, for one or more platforms:
--   kind 'publish': queued posts whose time has come and publishing posts whose next step is due,
--   in time order. "Now" is each workspace's clock (the Sandbox can be frozen with ?now=); leases
--   always run on real time.
-- `FOR UPDATE SKIP LOCKED` + the lease mean two overlapping ticks never take the same row.
-- Later kinds (stats, token refresh) add their own branch.
create function public.claim_work(
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
  if p_kind <> 'publish' then
    raise exception 'claim_work: unknown kind %', p_kind;
  end if;

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
end;
$$;

revoke all on function public.claim_work(text, integer, public.platform[], uuid[], integer)
  from public, anon, authenticated;
grant execute on function public.claim_work(text, integer, public.platform[], uuid[], integer)
  to service_role;

-- ───────────────────────────── heartbeat ─────────────────────────────

-- One row: when the last tick ran and what it did (the rail's "Scheduler running" line).
create table public.scheduler_status (
  id boolean primary key default true check (id),
  last_tick_at timestamptz,
  last_tick_ms integer check (last_tick_ms >= 0),
  last_summary jsonb,
  updated_at timestamptz not null default now()
);

insert into public.scheduler_status (id) values (true);

create trigger scheduler_status_updated_at before update on public.scheduler_status
  for each row execute function public.set_updated_at();

-- The allowed user may read it; only the server (service role) writes it.
alter table public.scheduler_status enable row level security;
grant select on public.scheduler_status to authenticated;
create policy allowed_user_read on public.scheduler_status for select to authenticated
  using ((select public.is_allowed_user()));

-- ───────────────────────────── the cron job ─────────────────────────────

-- Creates (or replaces) the every-minute job when both Vault secrets exist. Returns what it did.
create function public.schedule_tick() returns text
language plpgsql
set search_path = ''
as $$
declare
  has_url boolean;
  has_secret boolean;
begin
  select
    bool_or(name = 'broadcast_app_url' and coalesce(decrypted_secret, '') <> ''),
    bool_or(name = 'broadcast_cron_secret' and coalesce(decrypted_secret, '') <> '')
  into has_url, has_secret
  from vault.decrypted_secrets
  where name in ('broadcast_app_url', 'broadcast_cron_secret');

  if not coalesce(has_url, false) or not coalesce(has_secret, false) then
    return 'skipped: set the Vault secrets broadcast_app_url and broadcast_cron_secret first';
  end if;

  perform cron.schedule(
    'broadcast-tick',
    '* * * * *',
    $job$
      select net.http_post(
        url := rtrim(
          (select decrypted_secret from vault.decrypted_secrets where name = 'broadcast_app_url'),
          '/'
        ) || '/api/cron/tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'broadcast_cron_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      );
    $job$
  );
  return 'scheduled: broadcast-tick every minute';
end;
$$;

-- Removes the job (e.g. to pause posting). Safe when it doesn't exist.
create function public.unschedule_tick() returns text
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from cron.job where jobname = 'broadcast-tick') then
    perform cron.unschedule('broadcast-tick');
    return 'unscheduled';
  end if;
  return 'not scheduled';
end;
$$;

revoke all on function public.schedule_tick() from public, anon, authenticated;
revoke all on function public.unschedule_tick() from public, anon, authenticated;

-- Production already has the secrets on a re-run: (re)create the job. A no-op everywhere else.
select public.schedule_tick();
