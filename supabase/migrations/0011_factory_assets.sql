-- Content Factory assets (BC-26, docs/factory-api.md → /assets): style frames, stills and the
-- generation proxy's inputs (master portrait, slot audio) uploaded by Claude sessions through
-- signed URLs. Private; paths start with the workspace id; read through short-lived signed URLs.
-- Final renders go to the `videos` bucket like any Reel.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'factory',
  'factory',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'video/mp4']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy factory_allowed_user_select on storage.objects for select to authenticated
  using (bucket_id = 'factory' and (select public.is_allowed_user()));
