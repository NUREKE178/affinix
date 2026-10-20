-- ============================================================================
-- Affinix — optional photo attachment for posts
--
-- One optional image per post. Storage path convention:
--   <author_id>/<random-filename>.<ext>
-- storage.foldername(name)[1] is the author_id -- policies check that
-- against auth.uid(), the same shape 0005_storage.sql uses for the
-- org-folder check, but keyed to the uploading user directly since posts
-- aren't org-scoped.
-- ============================================================================

alter table posts add column image_url text;

insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

create policy "post-images: public read"
  on storage.objects for select
  using (bucket_id = 'post-images');

create policy "post-images: authenticated users upload to their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "post-images: owners can delete their own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
