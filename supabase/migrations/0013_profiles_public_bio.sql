-- ============================================================================
-- Affinix — bio/role on the feed's author-info popover
--
-- The feed lets you click a post's author to see who they are, but
-- get_public_profile() (0008) is the wrong tool for that: it's gated on
-- public_profile_enabled, an EXTERNAL/anonymous-sharing opt-in (the help
-- text next to that toggle says so explicitly -- "visible to everyone via
-- the link decisionos.app/u/username"), which defaults to false and most
-- users never touch. Routing the feed through it meant the feature was a
-- dead end for virtually every real account: click a name, land on a
-- "profile not found" page, even though you're both signed-in platform
-- users looking at the same feed.
--
-- profiles_public (0011) is the right shape for this instead -- it's
-- already scoped to `authenticated` only (never `anon`), the same
-- signed-in-only boundary the feed itself sits behind, with no exposure to
-- the public internet. Narrowing bio/role to that scope (rather than true
-- public/anonymous visibility) is what's being decided here: two more
-- non-sensitive, identity-adjacent fields (what 0011 already called
-- "already-effectively-public" for name/avatar), still never email or
-- notification settings, still never visible to anon.
-- ============================================================================

create or replace view profiles_public as
  select id, full_name, username, avatar_url, bio, role_title from profiles;
