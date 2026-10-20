-- ============================================================================
-- Affinix — platform admin flag + post deletion
--
-- Authors deleting their own posts already works: posts_delete_own
-- (0009_posts.sql) covers that with no change needed here.
--
-- is_admin is a genuine PLATFORM-wide flag, distinct from member_role
-- (organizations/0001_init.sql), which is scoped to a single organization
-- and has no bearing on a cross-org feature like the feed. There is no UI
-- to grant it -- it's set directly via SQL by whoever controls the
-- database, the same way any "first superuser" bootstrap works. Defaults
-- false for everyone, including every existing row.
--
-- profiles' existing "read own" policy already covers this new column for
-- its own row (no new SELECT policy needed) -- the frontend only ever
-- needs to know the VIEWER's own admin status, not anyone else's, so this
-- deliberately isn't added to profiles_public (0011) either.
-- ============================================================================

alter table profiles add column is_admin boolean not null default false;

create policy posts_delete_admin on posts
  for delete to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));
