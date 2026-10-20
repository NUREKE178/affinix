-- ============================================================================
-- Affinix — public identity view for platform-wide features (the feed)
--
-- profiles' own RLS ("profiles: read own", id = auth.uid()) is deliberately
-- restrictive -- the table holds private data (email, bio, notification
-- settings). But the feed (0009_posts.sql) is platform-wide: if you can see
-- someone's post, you should be able to see who posted it. Without this,
-- every post not authored by the viewer resolves its author to nothing --
-- not a privacy feature, just a side effect of a table-wide policy that
-- predates this feature.
--
-- Views can't carry column-level RLS, so the safety boundary here is the
-- SELECT list itself: only the already-effectively-public identity columns
-- (name, username, avatar), never email/bio/notification settings. The view
-- has no security_invoker, so it runs as its owner (the migration role),
-- which -- like every other table in this schema -- isn't subject to RLS on
-- tables it owns, the same mechanism get_public_profile() (0008) already
-- relies on for the same reason.
--
-- Queried as a plain second query from lib/postsStore.js, not a PostgREST
-- embed (`author:profiles(...)`) -- PostgREST's embedding resolves through
-- real foreign keys, and posts.author_id's FK points at profiles, not at
-- this view, so embedding it under a different name isn't supported.
-- ============================================================================

create view profiles_public as
  select id, full_name, username, avatar_url from profiles;

grant select on profiles_public to authenticated;
