-- Sandbox support (ADR 0003, BC-8): the fake provider's state, a fixed clock for the Sandbox, and
-- an atomic reset that only ever touches the Sandbox workspace.
--
-- The Sandbox workspace id is fixed by 0001_schema.sql: 00000000-0000-4000-8000-000000000002.

-- ───────────────────────────── Sandbox clock ─────────────────────────────

-- `?now=ISO` freezes the Sandbox clock (src/lib/clock.ts → nowFor). The Live workspace always runs
-- on real time.
alter table public.settings
  add column clock_override timestamptz,
  add constraint settings_clock_override_sandbox_only
    check (clock_override is null or workspace_id = '00000000-0000-4000-8000-000000000002');

-- ───────────────────────────── fake provider ─────────────────────────────

-- Per-account behaviour of the fake SocialProvider (src/lib/providers/fake.ts). Sandbox only.
create table public.fake_accounts (
  account_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade
    check (workspace_id = '00000000-0000-4000-8000-000000000002'),
  -- null: everything works.
  failure_mode text
    check (failure_mode in ('aspect_ratio', 'quota_exhausted', 'token_expired', 'network')),
  -- How many more calls fail; null: every call (while failure_mode is set).
  failures_left integer check (failures_left >= 0),
  -- A container reports FINISHED on this status check (1 = the first check).
  ready_after_checks integer not null default 2 check (ready_after_checks >= 1),
  -- Instagram's limit of API-published posts per rolling 24 hours.
  quota_limit integer not null default 100 check (quota_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, workspace_id)
    references public.social_accounts (id, workspace_id) on delete cascade
);

-- Reel containers the fake provider has created, and what became of them.
create table public.fake_containers (
  id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade
    check (workspace_id = '00000000-0000-4000-8000-000000000002'),
  account_id uuid not null,
  video_url text not null,
  caption text not null default '',
  status_checks integer not null default 0 check (status_checks >= 0),
  media_id text unique,
  permalink text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, workspace_id)
    references public.social_accounts (id, workspace_id) on delete cascade
);

create index fake_containers_account_published_idx
  on public.fake_containers (account_id, published_at);

create trigger fake_accounts_updated_at before update on public.fake_accounts
  for each row execute function public.set_updated_at();
create trigger fake_containers_updated_at before update on public.fake_containers
  for each row execute function public.set_updated_at();

-- Server only (service role): RLS on, no policies, no grants to browser roles.
alter table public.fake_accounts enable row level security;
alter table public.fake_containers enable row level security;

-- ───────────────────────────── reset ─────────────────────────────

-- Empties the Sandbox workspace in one transaction (scenarios call it before seeding). Every
-- statement is pinned to the Sandbox id, so Live rows can't be touched.
create function public.reset_sandbox() returns void
language plpgsql
set search_path = ''
as $$
declare
  sandbox constant uuid := '00000000-0000-4000-8000-000000000002';
begin
  delete from public.job_log where workspace_id = sandbox;
  -- Cascades to accounts, credentials, oauth states, posts, metrics and the fake provider's rows.
  delete from public.brands where workspace_id = sandbox;
  delete from public.media_assets where workspace_id = sandbox;
  delete from public.api_keys where workspace_id = sandbox;
  update public.settings set clock_override = null where workspace_id = sandbox;
end;
$$;

revoke all on function public.reset_sandbox() from public, anon, authenticated;
grant execute on function public.reset_sandbox() to service_role;
