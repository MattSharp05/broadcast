-- Storage for uploaded videos and their thumbnails (ADR 0005, BC-14).
--
-- * One private bucket, `videos`. Paths start with the workspace id:
--     <workspace_id>/videos/<upload id>.<mp4|mov>
--     <workspace_id>/thumbnails/<upload id>.jpg
-- * The browser never uploads with its own session: the server hands out signed upload URLs
--   (src/app/api/uploads/route.ts) and signed download URLs (thumbnails on the canvas, videos for
--   Instagram). Creating a signed URL as the signed-in user still needs the policies below, so the
--   allowed user (the same rule as every table, public.is_allowed_user()) gets the bucket's
--   objects. Nobody else does; the service role bypasses RLS.
-- * Limits match the Reels checks (src/lib/media/checks.ts): 50 MiB, MP4/MOV video and JPEG
--   thumbnails.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos',
  'videos',
  false,
  52428800,
  array['video/mp4', 'video/quicktime', 'image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy videos_allowed_user_select on storage.objects for select to authenticated
  using (bucket_id = 'videos' and (select public.is_allowed_user()));
create policy videos_allowed_user_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'videos' and (select public.is_allowed_user()));
create policy videos_allowed_user_update on storage.objects for update to authenticated
  using (bucket_id = 'videos' and (select public.is_allowed_user()))
  with check (bucket_id = 'videos' and (select public.is_allowed_user()));
create policy videos_allowed_user_delete on storage.objects for delete to authenticated
  using (bucket_id = 'videos' and (select public.is_allowed_user()));
