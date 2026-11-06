-- Connection health (BC-19): token refresh, connection checks, and reconnecting a specific account.

-- ───────────────────────────── token refresh ─────────────────────────────

-- The refresh step leases a credential row like publishing leases a post (claimed_until /
-- claim_token), so two overlapping ticks never refresh the same token. refresh_retry_at: a refresh
-- that failed in a way that may pass (network, Instagram having a problem) waits until then.
-- checked_at: when the scheduler last confirmed the token still works (the connection check).
alter table public.oauth_credentials
  add column refresh_claimed_until timestamptz,
  add column refresh_claim_token uuid,
  add column refresh_retry_at timestamptz,
  add column checked_at timestamptz;

-- Credentials whose token is due a refresh (src/lib/domain/health.ts → refreshPlan, which the
-- step checks again): last refreshed at least p_min_age_seconds ago, expiring within
-- p_window_seconds, by the workspace's clock. Expired tokens are included (the step flags their
-- account without calling the platform). Only ready accounts: one that needs attention waits for a
-- reconnect, which stores a fresh token.
create function public.claim_refresh(
  p_limit integer,
  p_platforms public.platform[],
  p_min_age_seconds integer,
  p_window_seconds integer,
  p_workspace_ids uuid[] default null,
  p_lease_seconds integer default 120
) returns table (account_id uuid, workspace_id uuid, claim_token uuid)
language plpgsql
set search_path = ''
as $$
begin
  return query
  with due as (
    select c.account_id
    from public.oauth_credentials c
    join public.social_accounts a on a.id = c.account_id and a.workspace_id = c.workspace_id
    join public.settings s on s.workspace_id = c.workspace_id
    where a.platform = any (p_platforms)
      and a.status = 'ready'
      and (p_workspace_ids is null or c.workspace_id = any (p_workspace_ids))
      and c.expires_at is not null
      and c.expires_at <= coalesce(s.clock_override, now()) + make_interval(secs => p_window_seconds)
      and (c.last_refreshed_at is null
        or c.last_refreshed_at <= coalesce(s.clock_override, now()) - make_interval(secs => p_min_age_seconds))
      and (c.refresh_retry_at is null or c.refresh_retry_at <= now())
      and (c.refresh_claimed_until is null or c.refresh_claimed_until < now())
    order by c.expires_at, c.account_id
    limit greatest(p_limit, 0)
    for update of c skip locked
  )
  update public.oauth_credentials c
  set refresh_claimed_until = now() + make_interval(secs => p_lease_seconds),
      refresh_claim_token = gen_random_uuid()
  from due
  where c.account_id = due.account_id
  returning c.account_id, c.workspace_id, c.refresh_claim_token;
end;
$$;

revoke all on function public.claim_refresh(integer, public.platform[], integer, integer, uuid[], integer)
  from public, anon, authenticated;
grant execute on function public.claim_refresh(integer, public.platform[], integer, integer, uuid[], integer)
  to service_role;

-- ───────────────────────────── reconnect ─────────────────────────────

-- A connect attempt started from an account's "Reconnect" names that account: the callback then
-- only accepts the same platform user, and resumes the account's paused posts.
alter table public.oauth_states
  add column account_id uuid,
  add foreign key (account_id, workspace_id)
    references public.social_accounts (id, workspace_id) on delete cascade;
