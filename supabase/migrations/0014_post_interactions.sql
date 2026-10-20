-- ============================================================================
-- Affinix — feed interactions: likes, comments, saves, notifications
--
-- Four additive tables, same platform-wide (non-org-scoped) shape as posts
-- (0009_posts.sql) -- they hang off posts/profiles, not organizations.
--
-- post_likes / post_comments mirror posts' own RLS shape: select is open to
-- every authenticated user (using (true)), own-row write, and -- for
-- comments only, since that's the one with free-text abuse potential, the
-- same way posts itself works -- an admin-delete-any policy layered
-- alongside delete-own (is_admin, 0012_post_deletion.sql).
--
-- post_saves is different on purpose: a private bookmark list, not a public
-- signal like a like count, so its select policy is scoped to the owner's
-- own rows rather than using (true).
--
-- notifications is the one table here that ISN'T author_id-shaped: the
-- interesting party is the RECIPIENT (the post's author), not whoever is
-- running the query, so recipient_id can't default to auth.uid() the way
-- every owner column elsewhere in this schema does. Left client-settable,
-- that column would let anyone spam a notification into any other user's
-- inbox; the insert policy below validates it server-side against the
-- post's real author instead of trusting the client, and the
-- actor_id <> recipient_id check doubles as a hard backstop against
-- self-notifications even if the app code's own suppression is ever
-- bypassed or buggy.
-- ============================================================================

create table post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index post_likes_post_id_idx on post_likes (post_id);

alter table post_likes enable row level security;

create policy post_likes_select_authenticated on post_likes
  for select to authenticated
  using (true);

create policy post_likes_insert_own on post_likes
  for insert to authenticated
  with check (user_id = auth.uid());

create policy post_likes_delete_own on post_likes
  for delete to authenticated
  using (user_id = auth.uid());


create table post_saves (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index post_saves_post_id_idx on post_saves (post_id);

alter table post_saves enable row level security;

-- Private bookmark list -- unlike post_likes, nobody else needs to read who
-- saved what, so this is scoped to the owner's own rows, not using (true).
create policy post_saves_select_own on post_saves
  for select to authenticated
  using (user_id = auth.uid());

create policy post_saves_insert_own on post_saves
  for insert to authenticated
  with check (user_id = auth.uid());

create policy post_saves_delete_own on post_saves
  for delete to authenticated
  using (user_id = auth.uid());


create table post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index post_comments_post_id_idx on post_comments (post_id, created_at);

alter table post_comments enable row level security;

create policy post_comments_select_authenticated on post_comments
  for select to authenticated
  using (true);

create policy post_comments_insert_own on post_comments
  for insert to authenticated
  with check (author_id = auth.uid());

create policy post_comments_delete_own on post_comments
  for delete to authenticated
  using (author_id = auth.uid());

-- Same admin-moderation backstop as posts_delete_admin (0012) -- comments
-- are free text with the same abuse surface as a post body.
create policy post_comments_delete_admin on post_comments
  for delete to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));


create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  actor_id uuid not null references profiles(id) on delete cascade default auth.uid(),
  post_id uuid not null references posts(id) on delete cascade,
  comment_id uuid not null references post_comments(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_recipient_id_idx on notifications (recipient_id, created_at desc);

alter table notifications enable row level security;

-- Unlike posts/comments, this is never using (true) -- a notification is
-- meaningful only to the one person it's for.
create policy notifications_select_own on notifications
  for select to authenticated
  using (recipient_id = auth.uid());

-- The actual trust boundary: actor_id must be the real caller (can't be
-- forged to make a notification look like it came from someone else), and
-- recipient_id must be the TRUE author of post_id, looked up server-side
-- rather than trusted from the client -- otherwise any signed-in user could
-- insert a row naming an arbitrary recipient_id and spam anyone's
-- notification feed. actor_id <> recipient_id additionally means Postgres
-- itself refuses a self-notification (commenting on your own post), not
-- just the app code that normally skips the insert.
create policy notifications_insert_validated on notifications
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and actor_id <> recipient_id
    and recipient_id = (select author_id from posts where id = post_id)
  );

-- Marking read/unread -- the only update this table ever needs.
create policy notifications_update_own on notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());
