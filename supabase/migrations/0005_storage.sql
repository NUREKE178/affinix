-- ============================================================================
-- Affinix — Storage bucket for variant assets (images/video)
--
-- Public read (stimuli must be viewable by anonymous participants on the
-- public link), writes restricted to org members who can manage the org
-- that owns the file. Path convention is load-bearing:
--   <organization_id>/<experiment_id>/<random-filename>.<ext>
-- storage.foldername(name) splits the object key on "/", so element [1] is
-- the organization_id -- that's what the policy checks against
-- can_manage_org(), the same helper every other write policy uses.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('variant-assets', 'variant-assets', true)
on conflict (id) do nothing;

create policy "variant-assets: public read"
  on storage.objects for select
  using (bucket_id = 'variant-assets');

create policy "variant-assets: org members can upload"
  on storage.objects for insert
  with check (
    bucket_id = 'variant-assets'
    and can_manage_org(((storage.foldername(name))[1])::uuid)
  );

create policy "variant-assets: org members can delete"
  on storage.objects for delete
  using (
    bucket_id = 'variant-assets'
    and can_manage_org(((storage.foldername(name))[1])::uuid)
  );
