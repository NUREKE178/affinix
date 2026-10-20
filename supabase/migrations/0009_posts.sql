-- ============================================================================
-- Affinix — marketing social layer, slice 1: posts + feed
--
-- Posts are platform-wide (reference profiles directly, no organization_id)
-- -- this is deliberately a cross-org "social feed for marketing
-- professionals" layer, additive alongside the org-scoped research product,
-- not a replacement for it or scoped to any one organization.
--
-- author_id defaults to auth.uid() and is never sent by the client, per the
-- lesson in 0004_server_derived_ownership.sql: a client-supplied value that
-- merely matches auth.uid() at write time is one more thing that can go
-- stale between read and write, while a server-side default can't.
-- ============================================================================

create table posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index posts_created_at_idx on posts (created_at desc);
create index posts_author_id_idx on posts (author_id);

create trigger posts_set_updated_at before update on posts
  for each row execute function set_updated_at();

alter table posts enable row level security;

-- Platform-wide feed: every signed-in user can read every post. (Unlike
-- organizations/experiments, there is no membership gate here, so the
-- INSERT...RETURNING-filtered-by-SELECT-policy trap from 0004 doesn't apply
-- -- a freshly inserted row is immediately visible under this policy no
-- matter who inserted it.)
create policy posts_select_authenticated on posts
  for select to authenticated
  using (true);

create policy posts_insert_own on posts
  for insert to authenticated
  with check (author_id = auth.uid());

create policy posts_update_own on posts
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy posts_delete_own on posts
  for delete to authenticated
  using (author_id = auth.uid());
