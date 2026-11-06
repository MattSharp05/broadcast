-- Broadcast schema (docs/TDD.md → Data & state; ADRs 0003 and 0004).
--
-- * Every data table carries workspace_id. Child rows repeat their parent's workspace_id and a
--   composite foreign key (parent id, workspace_id) keeps the two in step, so a Sandbox post can
--   never point at a Live account.
-- * Two workspaces exist from the start: Live and Sandbox (fixed ids, see below).
-- * RLS: the one allowed user (auth email = app_settings.allowed_email) may read and write every
--   table except oauth_credentials and app_settings (no policy: service role only) and the
--   api_keys.key_hash column (not granted to browser roles). The anon role gets nothing.
-- * Times are timestamptz (UTC).

-- ───────────────────────────── helpers ─────────────────────────────

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Every element is a 'HH:MM' time (no nulls).
create function public.valid_slots(slots text[]) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(s is not null and s ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'), true)
  from unnest(slots) as s;
$$;

-- ───────────────────────────── enums ─────────────────────────────

create type public.workspace_kind as enum ('live', 'sandbox');
-- tiktok is added in v1 with `alter type … add value`.
create type public.platform as enum ('instagram', 'fake');
create type public.account_status as enum ('ready', 'needs_attention', 'not_connected');
create type public.post_timing as enum ('queue', 'pinned');
create type public.post_status as enum ('queued', 'publishing', 'published', 'failed', 'paused', 'removed');
create type public.stat_offset as enum ('1h', '6h', '24h', '48h', '7d');

-- ───────────────────────────── app settings ─────────────────────────────

-- One row. allowed_email is written by the server (service role) from the ALLOWED_EMAIL env var
-- whenever a sign-in is requested, so the database and the app always agree on who may sign in.
-- Empty or missing → nobody gets any rows (fails closed).
create table public.app_settings (
  id boolean primary key default true check (id),
  allowed_email text,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id, allowed_email) values (true, null);

create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

-- True when the request's JWT belongs to the allowed email. security definer so it can read
-- app_settings, which browser roles cannot.
create function public.is_allowed_user() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select lower(s.allowed_email) = lower(auth.jwt() ->> 'email')
      from public.app_settings s
      where s.id and coalesce(s.allowed_email, '') <> ''
    ),
    false
  );
$$;

revoke all on function public.is_allowed_user() from public, anon;
grant execute on function public.is_allowed_user() to authenticated, service_role;

-- ───────────────────────────── tables ─────────────────────────────

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.workspace_kind not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fixed ids so code, scenarios and tests can name them.
insert into public.workspaces (id, name, kind) values
  ('00000000-0000-4000-8000-000000000001', 'Live', 'live'),
  ('00000000-0000-4000-8000-000000000002', 'Sandbox', 'sandbox');

create table public.settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- IANA zone; null until the browser sets it at first sign-in.
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.settings (workspace_id)
select id from public.workspaces;

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index brands_workspace_idx on public.brands (workspace_id);

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null,
  platform public.platform not null,
  platform_user_id text,
  handle text not null,
  profile_url text,
  description text not null default '',
  tags text[] not null default '{}',
  -- Daily posting times, 'HH:MM' in the workspace timezone.
  slots text[] not null default '{}'
    check (public.valid_slots(slots)),
  status public.account_status not null default 'not_connected',
  status_reason text,
  -- Link to the password-manager item. Passwords themselves are never stored.
  vault_url text,
  followers integer check (followers >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (brand_id, workspace_id) references public.brands (id, workspace_id) on delete cascade
);

create index social_accounts_workspace_idx on public.social_accounts (workspace_id);
create index social_accounts_brand_idx on public.social_accounts (brand_id);
create unique index social_accounts_platform_user_uniq
  on public.social_accounts (workspace_id, platform, platform_user_id)
  where platform_user_id is not null;

-- Encrypted OAuth tokens (ADR 0004). Service role only: RLS on, no policies, no grants.
create table public.oauth_credentials (
  account_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, workspace_id)
    references public.social_accounts (id, workspace_id) on delete cascade
);

create table public.oauth_states (
  state text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform public.platform not null,
  brand_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  foreign key (brand_id, workspace_id) references public.brands (id, workspace_id) on delete cascade
);

create index oauth_states_expires_idx on public.oauth_states (expires_at);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  storage_path text not null unique,
  thumbnail_path text,
  duration_s numeric(8, 3) check (duration_s > 0),
  width integer check (width > 0),
  height integer check (height > 0),
  bytes bigint check (bytes >= 0),
  -- Set when the video file is deleted after publishing; the thumbnail stays.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index media_assets_workspace_idx on public.media_assets (workspace_id);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid not null,
  media_id uuid not null,
  caption text not null default '',
  timing public.post_timing not null default 'queue',
  -- Order within the account's backlog (queue posts only).
  queue_position integer,
  scheduled_at timestamptz,
  status public.post_status not null default 'queued',
  container_id text,
  media_ig_id text,
  permalink text,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  last_error text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (timing <> 'pinned' or scheduled_at is not null),
  check (status <> 'published' or published_at is not null),
  foreign key (account_id, workspace_id)
    references public.social_accounts (id, workspace_id) on delete cascade,
  foreign key (media_id, workspace_id) references public.media_assets (id, workspace_id)
);

-- The scheduler's two lookups: due queued posts, and publishing posts waiting for their next try.
create index posts_status_scheduled_idx on public.posts (status, scheduled_at);
create index posts_status_next_attempt_idx on public.posts (status, next_attempt_at);
create index posts_account_idx on public.posts (account_id, timing, queue_position);
create index posts_workspace_idx on public.posts (workspace_id);
create index posts_media_idx on public.posts (media_id);

-- Stats snapshots after publishing (+1h … +7d). Rows are created with due_at when a post is
-- published; taken_at is set when the numbers are fetched. (`offset` is reserved in SQL and is a
-- PostgREST query parameter, hence stat_offset.)
create table public.post_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  post_id uuid not null,
  stat_offset public.stat_offset not null,
  due_at timestamptz not null,
  taken_at timestamptz,
  views integer,
  reach integer,
  likes integer,
  comments integer,
  shares integer,
  saves integer,
  created_at timestamptz not null default now(),
  unique (post_id, stat_offset),
  foreign key (post_id, workspace_id) references public.posts (id, workspace_id) on delete cascade
);

create index post_metrics_due_idx on public.post_metrics (due_at) where taken_at is null;
create index post_metrics_workspace_idx on public.post_metrics (workspace_id);

create table public.account_metrics (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid not null,
  day date not null,
  followers integer not null check (followers >= 0),
  created_at timestamptz not null default now(),
  primary key (account_id, day),
  foreign key (account_id, workspace_id)
    references public.social_accounts (id, workspace_id) on delete cascade
);

create index account_metrics_workspace_idx on public.account_metrics (workspace_id);

-- Content API keys (ADR 0005). key_hash is never readable by browser roles.
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  key_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index api_keys_workspace_idx on public.api_keys (workspace_id);

create table public.job_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null,
  post_id uuid,
  account_id uuid,
  ok boolean not null,
  message text,
  at timestamptz not null default now(),
  -- Deleting the post/account keeps the log line and clears only the reference.
  foreign key (post_id, workspace_id)
    references public.posts (id, workspace_id) on delete set null (post_id),
  foreign key (account_id, workspace_id)
    references public.social_accounts (id, workspace_id) on delete set null (account_id)
);

create index job_log_workspace_at_idx on public.job_log (workspace_id, at desc);

-- ───────────────────────────── updated_at triggers ─────────────────────────────

create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();
create trigger brands_updated_at before update on public.brands
  for each row execute function public.set_updated_at();
create trigger social_accounts_updated_at before update on public.social_accounts
  for each row execute function public.set_updated_at();
create trigger oauth_credentials_updated_at before update on public.oauth_credentials
  for each row execute function public.set_updated_at();
create trigger media_assets_updated_at before update on public.media_assets
  for each row execute function public.set_updated_at();
create trigger posts_updated_at before update on public.posts
  for each row execute function public.set_updated_at();
create trigger api_keys_updated_at before update on public.api_keys
  for each row execute function public.set_updated_at();

-- ───────────────────────────── grants + RLS ─────────────────────────────

-- Start from nothing for the browser roles, then grant what the allowed user needs. Later
-- migrations get the same start: tables they create are not granted to browser roles until a
-- migration says so.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

grant select, insert, update, delete on
  public.workspaces,
  public.settings,
  public.brands,
  public.social_accounts,
  public.oauth_states,
  public.media_assets,
  public.posts,
  public.post_metrics,
  public.account_metrics,
  public.job_log
to authenticated;
grant usage on all sequences in schema public to authenticated;

-- api_keys: every column but key_hash. Keys are created (and hashed) by the server.
grant select (id, workspace_id, name, last_used_at, revoked_at, created_at, updated_at)
  on public.api_keys to authenticated;
grant update (name, revoked_at) on public.api_keys to authenticated;
grant delete on public.api_keys to authenticated;

alter table public.app_settings enable row level security;
alter table public.workspaces enable row level security;
alter table public.settings enable row level security;
alter table public.brands enable row level security;
alter table public.social_accounts enable row level security;
alter table public.oauth_credentials enable row level security;
alter table public.oauth_states enable row level security;
alter table public.media_assets enable row level security;
alter table public.posts enable row level security;
alter table public.post_metrics enable row level security;
alter table public.account_metrics enable row level security;
alter table public.api_keys enable row level security;
alter table public.job_log enable row level security;

-- One policy per browser-accessible table: the allowed user, everything. (app_settings and
-- oauth_credentials deliberately have none.)
create policy allowed_user_all on public.workspaces for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.settings for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.brands for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.social_accounts for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.oauth_states for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.media_assets for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.posts for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.post_metrics for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.account_metrics for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.api_keys for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.job_log for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
