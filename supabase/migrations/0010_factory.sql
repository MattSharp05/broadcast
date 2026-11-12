-- Content Factory (BC-24): productions and their steps, the recipe on each video, avatars with
-- versions, the voice and music libraries, generation keys and jobs, factory tokens and budgets.
--
-- * Every workspace table carries workspace_id with a composite FK to its parent (CLAUDE.md).
-- * factory_voices and factory_music are shared catalogues (the same library for Live and the
--   Sandbox, seeded here): no workspace_id, read-only for the allowed user, written by migrations.
-- * gen_keys (encrypted provider keys) and factory_tokens (hashed session tokens) are server only:
--   RLS on, no policies, no grants. The browser never sees a key or a token.
-- * gen_jobs is readable (spend so far, per video and per month) but only the server writes it.
-- * The same factory video is never posted to more than one account (posts_one_account_per_video).

-- ───────────────────────────── enums ─────────────────────────────

-- The steps a Claude session runs (docs/factory-api.md). Dashboard-only sections (avatar, voice,
-- music, caption, schedule) are columns on productions, not steps.
create type public.factory_step as enum ('idea', 'script', 'style', 'visuals', 'face_quote', 'render');
create type public.factory_step_status as enum ('pending', 'running', 'waiting', 'approved', 'failed', 'skipped');
create type public.production_status as enum ('draft', 'running', 'waiting', 'ready', 'scheduled', 'failed');
create type public.gen_job_status as enum ('queued', 'running', 'completed', 'failed');

-- ───────────────────────────── settings and budgets ─────────────────────────────

create table public.factory_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  cap_per_video_usd numeric(8, 2) not null default 5 check (cap_per_video_usd >= 0),
  cap_monthly_usd numeric(8, 2) not null default 50 check (cap_monthly_usd >= 0),
  -- Face model keys from the registry (src/lib/factory/face-models.json).
  enabled_models text[] not null default '{placeholder}',
  default_face_model text not null default 'placeholder',
  fallback_face_model text,
  -- Default "Wait for me" / "Autopilot" per step: {"script": "auto", ...}; missing = wait.
  step_modes jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.factory_settings (workspace_id) select id from public.workspaces;

-- ───────────────────────────── libraries (shared) ─────────────────────────────

create table public.factory_voices (
  key text primary key,
  label text not null,
  description text not null default '',
  provider text not null default 'qwen',
  model text,
  -- 'designed' (VoiceDesign then clone), 'preset', 'clone' (a real person's voice: opt-in only).
  kind text not null check (kind in ('designed', 'preset', 'clone')),
  -- Path or URL of a short sample; null when no clip exists yet.
  sample_url text,
  sample_text text,
  licence text not null,
  -- Credit line the caption needs ("Voice: AI (Qwen3-TTS)").
  credit text not null,
  paid boolean not null default false,
  sort integer not null default 0
);

create table public.factory_music (
  key text primary key,
  title text not null,
  artist text not null,
  licence text not null check (licence in ('CC0', 'CC BY 4.0')),
  -- The exact credit for the caption (CC BY needs it; CC0 may be empty).
  credit text not null,
  source_url text not null,
  sample_url text not null,
  mood text not null default '',
  bpm integer,
  sort integer not null default 0
);

insert into public.factory_voices (key, label, description, provider, model, kind, sample_url, sample_text, licence, credit, sort) values
  ('design-m2', 'American male, low and understated (30s)',
   'Designed with Qwen3-TTS VoiceDesign, then every line cloned from one approved clip so it does not drift. Used on Moon tides and Grand Canyon.',
   'qwen', 'Qwen3-TTS-12Hz-1.7B-Base', 'designed', '/factory/voices/design-m2.mp3',
   'The hook clip Matthew approved in the Voice Picker.', 'Apache 2.0 (model)', 'Voice: AI (Qwen3-TTS)', 1),
  ('design-f2', 'American female, calm and low (30s)',
   'Designed with Qwen3-TTS VoiceDesign (Voice Picker round 2 pick). No clip in the repo yet: the first video with this voice saves its reference clip.',
   'qwen', 'Qwen3-TTS-12Hz-1.7B-Base', 'designed', null, null, 'Apache 2.0 (model)', 'Voice: AI (Qwen3-TTS)', 2);

insert into public.factory_music (key, title, artist, licence, credit, source_url, sample_url, mood, bpm, sort) values
  ('floating-cities', 'Floating Cities', 'Kevin MacLeod', 'CC BY 4.0',
   'Music: "Floating Cities" by Kevin MacLeod (incompetech.com), CC BY 4.0',
   'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Floating%20Cities.mp3',
   '/factory/music/floating-cities.mp3', 'calm, wonder, ambient', null, 1),
  ('wallpaper', 'Wallpaper', 'Kevin MacLeod', 'CC BY 4.0',
   'Music: "Wallpaper" by Kevin MacLeod (incompetech.com), CC BY 4.0',
   'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Wallpaper.mp3',
   '/factory/music/wallpaper.mp3', 'light, steady, product', 92, 2);

-- ───────────────────────────── accounts: face model, disclosure ─────────────────────────────

alter table public.social_accounts
  -- Account default face model (null: the workspace default).
  add column face_model text,
  -- The AI disclosure checklist on avatar accounts: Instagram's "AI-generated" profile label and
  -- the "AI creator" bio line. Ticked by Matthew; the dashboard reminds until both are done.
  add column ai_label_done boolean not null default false,
  add column ai_bio_done boolean not null default false;

-- ───────────────────────────── avatars ─────────────────────────────

create table public.avatars (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- One avatar per account (handoff); null while it isn't assigned.
  account_id uuid,
  name text not null check (length(trim(name)) > 0),
  -- The studio flow (references/avatar-profile.md): persona → portrait → face_pack → voice →
  -- screen_test → done (v1 saved).
  studio_step text not null default 'persona'
    check (studio_step in ('persona', 'portrait', 'face_pack', 'voice', 'screen_test', 'done')),
  current_version integer not null default 0 check (current_version >= 0),
  -- The profile being edited (avatar.json shape). Saved as a version when the look or voice changes.
  profile jsonb not null default '{}',
  -- Studio working state: persona drafts, portrait candidates, face pack, voice candidates, tests.
  studio jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (account_id, workspace_id)
    references public.social_accounts (id, workspace_id) on delete set null (account_id)
);

create index avatars_workspace_idx on public.avatars (workspace_id);
create unique index avatars_one_per_account on public.avatars (account_id) where account_id is not null;

create table public.avatar_versions (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  avatar_id uuid not null,
  version integer not null check (version >= 1),
  profile jsonb not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  primary key (avatar_id, version),
  foreign key (avatar_id, workspace_id)
    references public.avatars (id, workspace_id) on delete cascade
);

create index avatar_versions_workspace_idx on public.avatar_versions (workspace_id);

-- ───────────────────────────── productions ─────────────────────────────

create table public.productions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null default '',
  idea text not null default '',
  style text check (style in ('editorial-collage', 'handmade-2d', 'luminous-3d', 'motion-graphics', 'realistic-3d')),
  use_avatar boolean not null default false,
  avatar_id uuid,
  avatar_version integer,
  -- Per-video face model override (null: avatar, then account, then workspace default).
  face_model text,
  voice_key text references public.factory_voices (key),
  music_key text references public.factory_music (key),
  -- The one account this video is for (never several: "Remake for account B" instead).
  account_id uuid,
  status public.production_status not null default 'draft',
  -- Per-video "Wait for me" / "Autopilot" per step; missing keys use factory_settings.step_modes.
  step_modes jsonb not null default '{}',
  -- {"version": 2, "lines": [{"id": "l1", "text": "..."}]}
  script jsonb,
  caption text,
  caption_options jsonb not null default '[]',
  -- The final render, once uploaded; and the post it was queued as.
  media_id uuid,
  post_id uuid,
  remake_of uuid,
  -- Folder in video-editor (projects/<slug>).
  project_slug text,
  -- The latest Claude session working on this video.
  session_id text,
  session_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (avatar_id, workspace_id)
    references public.avatars (id, workspace_id) on delete set null (avatar_id),
  foreign key (account_id, workspace_id)
    references public.social_accounts (id, workspace_id) on delete set null (account_id),
  foreign key (media_id, workspace_id)
    references public.media_assets (id, workspace_id) on delete set null (media_id),
  foreign key (post_id, workspace_id)
    references public.posts (id, workspace_id) on delete set null (post_id),
  foreign key (remake_of, workspace_id)
    references public.productions (id, workspace_id) on delete set null (remake_of)
);

create index productions_workspace_idx on public.productions (workspace_id, created_at desc);

create table public.production_steps (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  production_id uuid not null,
  step public.factory_step not null,
  status public.factory_step_status not null default 'pending',
  progress integer not null default 0 check (progress between 0 and 100),
  message text,
  -- Checkpoint outputs: script text, stills, the face-cost quote, render info (docs/factory-api.md).
  output jsonb not null default '{}',
  attempt integer not null default 0 check (attempt >= 0),
  session_id text,
  session_url text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (production_id, step),
  foreign key (production_id, workspace_id)
    references public.productions (id, workspace_id) on delete cascade
);

create index production_steps_workspace_idx on public.production_steps (workspace_id);

-- What Matthew asked to redo. Non-avatar reworks reuse every paid face clip (gen_jobs by slot).
create table public.production_reworks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  production_id uuid not null,
  target text not null check (target in ('script_line', 'scene', 'voice', 'music', 'caption', 'avatar_slot')),
  -- Which line, scene or slot (null for voice, music, caption).
  ref text,
  note text not null default '',
  -- Only avatar_slot reworks can cost money; the quote is shown before it runs.
  quote_usd numeric(10, 4) not null default 0 check (quote_usd >= 0),
  status text not null default 'requested' check (status in ('requested', 'running', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (production_id, workspace_id)
    references public.productions (id, workspace_id) on delete cascade
);

create index production_reworks_production_idx on public.production_reworks (production_id, created_at);
create index production_reworks_workspace_idx on public.production_reworks (workspace_id);

-- ───────────────────────────── generation ─────────────────────────────

-- Provider keys, encrypted with TOKEN_ENC_KEY (src/lib/crypto/tokens.ts). Server only.
create table public.gen_keys (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('fal', 'kling', 'dashscope', 'hedra', 'heygen', 'elevenlabs')),
  key_enc text not null,
  last4 text not null,
  tested_at timestamptz,
  test_ok boolean,
  test_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider)
);

-- Every paid (or fake) generation: the spend log. Never charged twice for one idempotency key.
create table public.gen_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  production_id uuid,
  avatar_id uuid,
  kind text not null default 'face' check (kind in ('face', 'image', 'voice')),
  slot text not null,
  model text not null,
  provider text not null,
  idempotency_key text not null,
  seconds numeric(8, 2) not null check (seconds > 0),
  quote_usd numeric(10, 4) not null check (quote_usd >= 0),
  cost_usd numeric(10, 4) check (cost_usd >= 0),
  status public.gen_job_status not null default 'queued',
  provider_request_id text,
  status_url text,
  response_url text,
  output_url text,
  error text,
  -- What was asked (prompt, seed; never data URIs or keys).
  input jsonb not null default '{}',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  foreign key (production_id, workspace_id)
    references public.productions (id, workspace_id) on delete set null (production_id),
  foreign key (avatar_id, workspace_id)
    references public.avatars (id, workspace_id) on delete set null (avatar_id)
);

create index gen_jobs_production_idx on public.gen_jobs (production_id, slot);
create index gen_jobs_workspace_created_idx on public.gen_jobs (workspace_id, created_at);

-- Scoped, expiring tokens for Claude sessions (factory endpoints and /api/gen/*). SHA-256 only.
create table public.factory_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  production_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (production_id, workspace_id)
    references public.productions (id, workspace_id) on delete cascade
);

create index factory_tokens_production_idx on public.factory_tokens (production_id);

-- ───────────────────────────── recipe and disclosure on media and posts ─────────────────────────────

-- The manifest of tagged parts (style, avatar + version, face model, face share, voice, music,
-- hook, script version, series, cost). Set on factory videos; null for plain uploads.
alter table public.media_assets add column recipe jsonb;
-- Avatar videos: is_ai_generated on the Instagram container (set when queued from the factory).
alter table public.posts add column is_ai_generated boolean not null default false;

-- A factory video (media with a recipe) is posted to one account only. Remake it for another.
create function public.posts_one_account_per_video() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'removed'
    and exists (select 1 from public.media_assets m where m.id = new.media_id and m.recipe is not null)
    and exists (
      select 1 from public.posts p
      where p.media_id = new.media_id and p.id <> new.id and p.status <> 'removed'
    )
  then
    raise exception 'This factory video is already queued on another account. Remake it for this account instead.'
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

create trigger posts_one_account_per_video before insert or update of media_id, status on public.posts
  for each row execute function public.posts_one_account_per_video();

-- ───────────────────────────── updated_at ─────────────────────────────

create trigger factory_settings_updated_at before update on public.factory_settings
  for each row execute function public.set_updated_at();
create trigger avatars_updated_at before update on public.avatars
  for each row execute function public.set_updated_at();
create trigger productions_updated_at before update on public.productions
  for each row execute function public.set_updated_at();
create trigger production_steps_updated_at before update on public.production_steps
  for each row execute function public.set_updated_at();
create trigger production_reworks_updated_at before update on public.production_reworks
  for each row execute function public.set_updated_at();
create trigger gen_keys_updated_at before update on public.gen_keys
  for each row execute function public.set_updated_at();
create trigger gen_jobs_updated_at before update on public.gen_jobs
  for each row execute function public.set_updated_at();

-- ───────────────────────────── grants + RLS ─────────────────────────────

grant select, insert, update, delete on
  public.factory_settings,
  public.avatars,
  public.avatar_versions,
  public.productions,
  public.production_steps,
  public.production_reworks
to authenticated;
grant select on public.factory_voices, public.factory_music, public.gen_jobs to authenticated;

alter table public.factory_settings enable row level security;
alter table public.factory_voices enable row level security;
alter table public.factory_music enable row level security;
alter table public.avatars enable row level security;
alter table public.avatar_versions enable row level security;
alter table public.productions enable row level security;
alter table public.production_steps enable row level security;
alter table public.production_reworks enable row level security;
alter table public.gen_keys enable row level security;
alter table public.gen_jobs enable row level security;
alter table public.factory_tokens enable row level security;

create policy allowed_user_all on public.factory_settings for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_read on public.factory_voices for select to authenticated
  using ((select public.is_allowed_user()));
create policy allowed_user_read on public.factory_music for select to authenticated
  using ((select public.is_allowed_user()));
create policy allowed_user_all on public.avatars for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.avatar_versions for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.productions for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.production_steps for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.production_reworks for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_read on public.gen_jobs for select to authenticated
  using ((select public.is_allowed_user()));
-- gen_keys and factory_tokens: no policy (service role only).

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
  delete from public.productions where workspace_id = sandbox;
  delete from public.avatars where workspace_id = sandbox;
  delete from public.gen_keys where workspace_id = sandbox;
  -- Cascades to accounts, credentials, oauth states, posts, metrics and the fake provider's rows.
  delete from public.brands where workspace_id = sandbox;
  delete from public.media_assets where workspace_id = sandbox;
  delete from public.api_keys where workspace_id = sandbox;
  update public.settings set clock_override = null where workspace_id = sandbox;
  update public.factory_settings set
    cap_per_video_usd = 5, cap_monthly_usd = 50, enabled_models = '{placeholder}',
    default_face_model = 'placeholder', fallback_face_model = null, step_modes = '{}'
  where workspace_id = sandbox;
end;
$$;

revoke all on function public.reset_sandbox() from public, anon, authenticated;
grant execute on function public.reset_sandbox() to service_role;
