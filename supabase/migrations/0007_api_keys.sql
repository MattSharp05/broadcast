-- Content API (ADR 0005, BC-17): uploads handed out to API keys, and one queue position per post.
--
-- * api_keys (0001) already holds the keys: a SHA-256 hash only, never the key; browser roles
--   can't read key_hash. Keys are created by the server (service role) on /dev/api-keys.
-- * content_uploads: one row per signed upload URL given to an API client. The client only ever
--   sees the upload's id; the storage path stays on the server, so a client can't name a path
--   (no path traversal) and can only queue uploads of its own workspace. `used_at` is set when a
--   POST /api/content takes the upload, so one upload is queued at most once. The rows also count
--   uploads per key for the rate limit. Server only: RLS on, no policies, no grants.
-- * posts: two adds racing on one account could get the same queue_position (BC-14's note). A
--   unique index makes the second insert fail; queueContent then retries with the next position.

alter table public.api_keys add constraint api_keys_id_workspace_key unique (id, workspace_id);

create table public.content_uploads (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  api_key_id uuid not null,
  storage_path text not null unique,
  file_name text not null,
  content_type text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (api_key_id, workspace_id)
    references public.api_keys (id, workspace_id) on delete cascade
);

create index content_uploads_key_created_idx on public.content_uploads (api_key_id, created_at);
create index content_uploads_workspace_idx on public.content_uploads (workspace_id);

alter table public.content_uploads enable row level security;

create unique index posts_account_queue_position_key
  on public.posts (account_id, queue_position)
  where queue_position is not null;
