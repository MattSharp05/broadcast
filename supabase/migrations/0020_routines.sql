-- Routines, video tags, genre (ADR 0009).
--
-- A routine makes and schedules many videos over a time frame: its posting schedule (one slot
-- per post, per account) is laid out first, a planner session writes one brief per slot (genre,
-- idea, style, voice, music), and each slot is built by one Content Factory production, started
-- `lead_minutes` before the slot. Templates keep the reusable part (references, rules, mix).

-- ───────────────────────────── videos: genre, tags, run mode ─────────────────────────────

-- explainer, brainteaser, … (src/lib/domain/genres.ts suggests them; any short label is allowed).
alter table public.productions
  add column genre text check (genre is null or char_length(genre) between 1 and 40);
-- Campaign tags ("Trip") on a video; the posts table filters on them.
alter table public.productions add column tags text[] not null default '{}';
-- Posts without a production (content API, Add content) carry their own tags.
alter table public.posts add column tags text[] not null default '{}';
-- per_step: one session per step (ADR 0007). one_session: one session runs every step (routines).
alter table public.productions
  add column run_mode text not null default 'per_step' check (run_mode in ('per_step', 'one_session'));

create index productions_tags_idx on public.productions using gin (tags);
create index posts_tags_idx on public.posts using gin (tags);

-- ───────────────────────────── templates and routines ─────────────────────────────

-- The reusable part: references, styles, genre mix, voices, music, free-text rules
-- (src/lib/domain/routines.ts → RoutineConfig).
create table public.routine_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, name)
);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  template_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  -- draft → planning → planned → running → done; paused and cancelled at any time after draft.
  status text not null default 'draft'
    check (status in ('draft', 'planning', 'planned', 'running', 'paused', 'done', 'cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  posts_per_day integer not null check (posts_per_day between 1 and 48),
  -- Daily posting window in the workspace timezone ("09:00"–"21:00"; "00:00"–"24:00" all day).
  window_start text not null default '09:00' check (window_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  window_end text not null default '21:00' check (window_end ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'),
  -- A slot's video starts this long before it posts.
  lead_minutes integer not null default 180 check (lead_minutes between 30 and 2880),
  -- At most this many of the routine's videos build at once.
  max_parallel integer not null default 3 check (max_parallel between 1 and 10),
  -- auto: a finished video is scheduled at its slot. review: it waits for Matthew's approval.
  approval text not null default 'review' check (approval in ('auto', 'review')),
  -- Total spend cap for the routine's paid generation (null: only the factory caps).
  budget_usd numeric(10, 2) check (budget_usd is null or budget_usd >= 0),
  config jsonb not null default '{}',
  tags text[] not null default '{}',
  plan_message text,
  plan_session_url text,
  planned_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (ends_at > starts_at),
  foreign key (template_id, workspace_id)
    references public.routine_templates (id, workspace_id) on delete set null (template_id)
);

create index routines_workspace_idx on public.routines (workspace_id, created_at desc);
create index routines_status_idx on public.routines (status);

create table public.routine_accounts (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  routine_id uuid not null,
  account_id uuid not null,
  primary key (routine_id, account_id),
  foreign key (routine_id, workspace_id)
    references public.routines (id, workspace_id) on delete cascade,
  foreign key (account_id, workspace_id)
    references public.social_accounts (id, workspace_id) on delete cascade
);

create index routine_accounts_workspace_idx on public.routine_accounts (workspace_id);

-- One post of the routine's schedule. open (no brief yet) → planned (brief) → building →
-- review (waits for Matthew) | scheduled → posted; or failed, missed (not ready in time), skipped.
create table public.routine_slots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  routine_id uuid not null,
  account_id uuid not null,
  position integer not null check (position >= 1),
  post_at timestamptz not null,
  build_at timestamptz not null,
  brief jsonb,
  status text not null default 'open'
    check (status in ('open', 'planned', 'building', 'review', 'scheduled', 'posted', 'failed', 'missed', 'skipped')),
  production_id uuid,
  post_id uuid,
  message text,
  -- Automatic render retries after a failed check (at most one).
  retries integer not null default 0 check (retries >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (routine_id, position),
  check (build_at <= post_at),
  foreign key (routine_id, workspace_id)
    references public.routines (id, workspace_id) on delete cascade,
  foreign key (account_id, workspace_id)
    references public.social_accounts (id, workspace_id) on delete cascade,
  foreign key (production_id, workspace_id)
    references public.productions (id, workspace_id) on delete set null (production_id),
  foreign key (post_id, workspace_id)
    references public.posts (id, workspace_id) on delete set null (post_id)
);

create index routine_slots_due_idx on public.routine_slots (status, build_at);
create index routine_slots_routine_idx on public.routine_slots (routine_id, post_at);
create index routine_slots_workspace_idx on public.routine_slots (workspace_id);
create unique index routine_slots_production_idx on public.routine_slots (production_id)
  where production_id is not null;

-- Which routine a video was made for (the posts table filters on it).
alter table public.productions add column routine_id uuid;
alter table public.productions
  add constraint productions_routine_fk foreign key (routine_id, workspace_id)
  references public.routines (id, workspace_id) on delete set null (routine_id);
create index productions_routine_idx on public.productions (routine_id) where routine_id is not null;

-- ───────────────────────────── planner tokens ─────────────────────────────

-- A factory token is for one video, or (the planner session) for one routine.
alter table public.factory_tokens alter column production_id drop not null;
alter table public.factory_tokens add column routine_id uuid;
alter table public.factory_tokens
  add constraint factory_tokens_routine_fk foreign key (routine_id, workspace_id)
  references public.routines (id, workspace_id) on delete cascade;
alter table public.factory_tokens
  add constraint factory_tokens_one_scope check (num_nonnulls(production_id, routine_id) = 1);

-- ───────────────────────────── triggers ─────────────────────────────

create trigger routine_templates_updated_at before update on public.routine_templates
  for each row execute function public.set_updated_at();
create trigger routines_updated_at before update on public.routines
  for each row execute function public.set_updated_at();
create trigger routine_slots_updated_at before update on public.routine_slots
  for each row execute function public.set_updated_at();

-- ───────────────────────────── grants + RLS ─────────────────────────────

grant select, insert, update, delete on
  public.routine_templates,
  public.routines,
  public.routine_accounts,
  public.routine_slots
to authenticated;

alter table public.routine_templates enable row level security;
alter table public.routines enable row level security;
alter table public.routine_accounts enable row level security;
alter table public.routine_slots enable row level security;

create policy allowed_user_all on public.routine_templates for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.routines for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.routine_accounts for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.routine_slots for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));

-- ───────────────────────────── Sandbox reset ─────────────────────────────

create or replace function public.reset_sandbox() returns void
language plpgsql
set search_path = ''
as $$
declare
  sandbox constant uuid := '00000000-0000-4000-8000-000000000002';
begin
  delete from public.job_log where workspace_id = sandbox;
  delete from public.gen_jobs where workspace_id = sandbox;
  delete from public.routines where workspace_id = sandbox;
  delete from public.routine_templates where workspace_id = sandbox;
  delete from public.productions where workspace_id = sandbox;
  delete from public.avatars where workspace_id = sandbox;
  delete from public.gen_keys where workspace_id = sandbox;
  delete from public.brands where workspace_id = sandbox;
  delete from public.media_assets where workspace_id = sandbox;
  delete from public.api_keys where workspace_id = sandbox;
  update public.settings set clock_override = null where workspace_id = sandbox;
  update public.factory_settings set
    cap_per_video_usd = 5, cap_monthly_usd = 50, enabled_models = '{placeholder}',
    default_face_model = 'placeholder', fallback_face_model = null, step_modes = '{}',
    enabled_mesh_models = '{placeholder}', default_mesh_model = 'placeholder', fallback_mesh_model = null
  where workspace_id = sandbox;
end;
$$;

revoke all on function public.reset_sandbox() from public, anon, authenticated;
grant execute on function public.reset_sandbox() to service_role;
