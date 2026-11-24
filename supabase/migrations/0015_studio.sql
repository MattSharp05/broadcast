-- Studio (BC-34, ADR 0008): every render kept as a numbered version, review notes pinned to
-- frames, batches of notes answered by the next version, an activity feed, storyboard cards and a
-- ready-to-post delivery pack per version.
--
-- * Every table carries workspace_id with a composite FK to its parent (CLAUDE.md).
-- * Versions never change after insert, except: media_id set once the full file is stored,
--   media_id / proxy_path cleared by pruning (pruned_at), and batch_id cleared if its batch goes.
-- * productions.media_id stays "the version chosen for posting" (BC-36 sets it).
-- * Everything cascades from productions, so reset_sandbox() (which deletes the Sandbox's
--   productions) clears these tables too.

-- ───────────────────────────── versions ─────────────────────────────

create table public.production_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  production_id uuid not null,
  number integer not null check (number >= 1),
  -- The full file, once stored (null until then, and again once pruned).
  media_id uuid,
  -- 720p draft in the `factory` bucket.
  proxy_path text,
  contact_sheet_path text,
  duration_s numeric(8, 3) check (duration_s > 0),
  fps numeric(6, 3) check (fps > 0),
  width integer check (width > 0),
  height integer check (height > 0),
  bytes bigint check (bytes >= 0),
  -- The video-editor commit the render came from (required: every version is reproducible).
  git_sha text not null check (length(trim(git_sha)) > 0),
  made_by text not null check (made_by in ('render', 'revise', 'import')),
  -- The batch of notes this version answers (revise only).
  batch_id uuid,
  intent text not null default '' check (length(intent) <= 160),
  loudness_lufs numeric(5, 2),
  true_peak_db numeric(5, 2),
  pruned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (production_id, number),
  foreign key (production_id, workspace_id)
    references public.productions (id, workspace_id) on delete cascade,
  foreign key (media_id, workspace_id)
    references public.media_assets (id, workspace_id) on delete set null (media_id)
);

create index production_versions_workspace_idx on public.production_versions (workspace_id);

-- ───────────────────────────── review batches and notes ─────────────────────────────

create table public.review_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  production_id uuid not null,
  -- The version the notes are on.
  version_id uuid not null,
  status text not null default 'sent' check (status in ('sent', 'running', 'answered', 'failed')),
  sent_at timestamptz not null default now(),
  -- The version that answered the batch.
  answered_by_version uuid,
  session_id text,
  session_url text,
  unique (id, workspace_id),
  foreign key (production_id, workspace_id)
    references public.productions (id, workspace_id) on delete cascade,
  foreign key (version_id, workspace_id)
    references public.production_versions (id, workspace_id) on delete cascade,
  foreign key (answered_by_version, workspace_id)
    references public.production_versions (id, workspace_id) on delete set null (answered_by_version)
);

create index review_batches_production_idx on public.review_batches (production_id, sent_at);
create index review_batches_workspace_idx on public.review_batches (workspace_id);

alter table public.production_versions
  add foreign key (batch_id, workspace_id)
    references public.review_batches (id, workspace_id) on delete set null (batch_id);

create table public.review_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  production_id uuid not null,
  version_id uuid not null,
  number integer not null check (number >= 1),
  kind text not null check (kind in ('moment', 'region', 'general')),
  t_s numeric(8, 3) check (t_s >= 0),
  frame integer check (frame >= 0),
  -- {x, y, w, h}, normalised 0–1 (region notes only; validated in src/lib/domain/factory/notes.ts).
  box jsonb,
  text text not null check (length(trim(text)) between 1 and 2000),
  crop_path text,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'answered', 'not_changed', 'resolved')),
  batch_id uuid,
  reply text,
  answered_in_version uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version_id, number),
  check (
    case kind
      when 'general' then t_s is null and frame is null and box is null
      when 'moment' then t_s is not null and frame is not null and box is null
      else t_s is not null and frame is not null and jsonb_typeof(box) = 'object'
    end
  ),
  foreign key (production_id, workspace_id)
    references public.productions (id, workspace_id) on delete cascade,
  foreign key (version_id, workspace_id)
    references public.production_versions (id, workspace_id) on delete cascade,
  foreign key (batch_id, workspace_id)
    references public.review_batches (id, workspace_id) on delete set null (batch_id),
  foreign key (answered_in_version, workspace_id)
    references public.production_versions (id, workspace_id) on delete set null (answered_in_version)
);

create index review_notes_production_idx on public.review_notes (production_id, version_id, number);
create index review_notes_batch_idx on public.review_notes (batch_id) where batch_id is not null;
create index review_notes_workspace_idx on public.review_notes (workspace_id);

-- ───────────────────────────── activity feed ─────────────────────────────

create table public.production_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  production_id uuid not null,
  actor text not null check (actor in ('session', 'matthew', 'system')),
  step text,
  intent text not null check (length(trim(intent)) between 1 and 160),
  session_url text,
  created_at timestamptz not null default now(),
  foreign key (production_id, workspace_id)
    references public.productions (id, workspace_id) on delete cascade
);

create index production_events_production_idx on public.production_events (production_id, created_at desc);
create index production_events_workspace_idx on public.production_events (workspace_id);

-- ───────────────────────────── storyboard ─────────────────────────────

alter table public.productions
  add column board_rev integer not null default 0 check (board_rev >= 0),
  add column board_approved_at timestamptz;

create table public.board_cards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  production_id uuid not null,
  position integer not null check (position >= 0),
  text text not null default '' check (length(text) <= 280),
  seconds numeric(6, 2) not null check (seconds > 0),
  still_path text,
  scene_id text,
  status text not null default 'planned' check (status in ('planned', 'approved', 'built')),
  foreign key (production_id, workspace_id)
    references public.productions (id, workspace_id) on delete cascade
);

create index board_cards_production_idx on public.board_cards (production_id, position);
create index board_cards_workspace_idx on public.board_cards (workspace_id);

-- ───────────────────────────── delivery ─────────────────────────────

create table public.delivery_packs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  production_id uuid not null,
  version_id uuid not null unique,
  cover_path text,
  cover_t_s numeric(8, 3) check (cover_t_s >= 0),
  caption text not null default '' check (length(caption) <= 2200),
  hashtags text[] not null default '{}',
  -- src/lib/domain/factory/delivery.ts → DeliveryCheck[].
  checks jsonb not null default '[]',
  manifest jsonb not null default '{}',
  ready_at timestamptz,
  foreign key (production_id, workspace_id)
    references public.productions (id, workspace_id) on delete cascade,
  foreign key (version_id, workspace_id)
    references public.production_versions (id, workspace_id) on delete cascade
);

create index delivery_packs_production_idx on public.delivery_packs (production_id);
create index delivery_packs_workspace_idx on public.delivery_packs (workspace_id);

-- Instagram `cover_url` source (BC-43).
alter table public.media_assets add column cover_path text;

-- ───────────────────────────── triggers ─────────────────────────────

-- Versions are a record: only storing the file, pruning and a deleted batch may touch a row.
create or replace function public.production_versions_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - '{media_id,proxy_path,pruned_at,batch_id}'::text[])
     is distinct from (to_jsonb(old) - '{media_id,proxy_path,pruned_at,batch_id}'::text[]) then
    raise exception 'production versions never change after insert' using errcode = '23514';
  end if;
  if new.batch_id is distinct from old.batch_id and new.batch_id is not null then
    raise exception 'a version''s batch can only be cleared' using errcode = '23514';
  end if;
  if new.proxy_path is distinct from old.proxy_path and new.proxy_path is not null then
    raise exception 'a version''s proxy can only be pruned' using errcode = '23514';
  end if;
  if new.media_id is distinct from old.media_id and old.media_id is not null and new.media_id is not null then
    raise exception 'a version''s file can only be stored once or pruned' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger production_versions_immutable before update on public.production_versions
  for each row execute function public.production_versions_immutable();

create trigger review_notes_updated_at before update on public.review_notes
  for each row execute function public.set_updated_at();

-- ───────────────────────────── grants + RLS ─────────────────────────────

grant select, insert, update, delete on
  public.production_versions,
  public.review_batches,
  public.review_notes,
  public.production_events,
  public.board_cards,
  public.delivery_packs
to authenticated;

alter table public.production_versions enable row level security;
alter table public.review_batches enable row level security;
alter table public.review_notes enable row level security;
alter table public.production_events enable row level security;
alter table public.board_cards enable row level security;
alter table public.delivery_packs enable row level security;

create policy allowed_user_all on public.production_versions for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.review_batches for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.review_notes for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.production_events for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.board_cards for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.delivery_packs for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
