-- Hero 3D assets (BC-30; video-editor hero-assets skill, contract in docs/factory-api.md).
--
-- * hero_proposals: a session proposes an AI-generated 3D model for a film's focal object, with
--   stills of its three.js version, the input it would use and the suggested model. A comparison
--   stage adds the generated stills. One row per (workspace, proposal_id).
-- * hero_decisions: every choice Matthew makes, with the model, the budget and his reason (the
--   video-editor skill learns from the export, GET /api/factory/hero-decisions).
-- * Mesh jobs are gen_jobs with kind 'mesh' (slot = proposal_id): same caps, idempotency and spend.
--   The proxy accepts one only after a `generate` decision for that proposal and model.

alter table public.gen_jobs drop constraint gen_jobs_kind_check;
alter table public.gen_jobs add constraint gen_jobs_kind_check check (kind in ('face', 'image', 'voice', 'mesh'));

alter table public.factory_settings
  add column enabled_mesh_models text[] not null default '{placeholder}',
  add column default_mesh_model text not null default 'placeholder',
  add column fallback_mesh_model text;

create table public.hero_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  production_id uuid not null,
  proposal_id text not null check (length(proposal_id) between 1 and 120),
  object text not null,
  scene text not null default '',
  reason text not null default '',
  why_generate text not null default '',
  on_screen text not null default '',
  -- {"mode": "image|text", "prompt", "image"} (image as a storage: path once stored)
  input jsonb not null default '{}',
  suggested_model text,
  estimate_usd numeric(10, 4) not null default 0 check (estimate_usd >= 0),
  -- The session's price table: [{model, label, options, price_usd, status, licence}]
  options jsonb not null default '[]',
  -- [{label, url}] (storage: paths)
  stills jsonb not null default '[]',
  comparison_stills jsonb not null default '[]',
  stage text not null default 'proposal' check (stage in ('proposal', 'comparison')),
  status text not null default 'pending' check (status in ('pending', 'decided')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, proposal_id),
  unique (id, workspace_id),
  foreign key (production_id, workspace_id)
    references public.productions (id, workspace_id) on delete cascade
);

create index hero_proposals_production_idx on public.hero_proposals (production_id, created_at);

create table public.hero_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  hero_proposal_id uuid not null,
  stage text not null check (stage in ('proposal', 'comparison')),
  choice text not null check (choice in ('keep_threejs', 'redo_threejs', 'generate', 'use_generated', 'keep_threejs_after_compare')),
  model text,
  budget_usd numeric(10, 4) check (budget_usd >= 0),
  notes text not null default '',
  reason text not null check (length(trim(reason)) > 0),
  decided_at timestamptz not null default now(),
  foreign key (hero_proposal_id, workspace_id)
    references public.hero_proposals (id, workspace_id) on delete cascade
);

create index hero_decisions_proposal_idx on public.hero_decisions (hero_proposal_id, decided_at);
create index hero_decisions_workspace_idx on public.hero_decisions (workspace_id, decided_at);

create trigger hero_proposals_updated_at before update on public.hero_proposals
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.hero_proposals, public.hero_decisions to authenticated;
alter table public.hero_proposals enable row level security;
alter table public.hero_decisions enable row level security;
create policy allowed_user_all on public.hero_proposals for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy allowed_user_all on public.hero_decisions for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));

-- Generated .glb files are copied into the factory bucket (fal's URLs expire).
update storage.buckets
  set allowed_mime_types = array['image/jpeg', 'image/png', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'video/mp4', 'model/gltf-binary']
  where id = 'factory';

-- The Sandbox reset also puts the 3D model settings back.
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
