-- The database twin of the obscenity filter (migration 0033): the same examples as tests/profanity.test.js, and the trigger on profiles.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAILED: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function t.raises(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlerrm; end $$;

do $$
declare s text;
begin
  foreach s in array array['Хуйло', 'хуууй', 'xуй', 'ПИЗДА', 'п и з д а', '5ука', 'сука', 'Бляяять', 'sh1t', 'FUCK', 'f.u.c.k', 'Mother-fucker', 'nigga', 'n1gger', 'faggot', 'Dick', 'Сиктир', 'қотақ', 'жезөкше', 'Ебанат', 'xuy_228', 'pizda', 'siktir', 'долбоёб', 'Мудак Мудаков', 'Aman Fuckov'] loop
    perform t.ok(is_profane(s), 'refused: ' || s);
  end loop;
  foreach s in array array['Нұрлан Худайберген', 'Амина Сейтова', 'nu4lan', 'Ardana Nogaibaeva', 'Marzhan Rustamova', 'Asilay', 'Darkhan', 'Аблязов', 'Scunthorpe', 'Hancock', 'Сучков', 'Лохматов', 'Assel', 'Хуан Карлос', 'Мудрый', 'Hui Zhang', 'Huy Nguyen', 'Пушкин', 'Тураш_01', 'Web Developer, Vibe Coder', 'Student', 'Head of Research', ''] loop
    perform t.ok(not is_profane(s), 'passes: ' || s);
  end loop;
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ee', 'prof1@x'), ('00000000-0000-0000-0000-0000000000ef', 'prof2@x');
do $$
declare a1 uuid := '00000000-0000-0000-0000-0000000000ee'; a2 uuid := '00000000-0000-0000-0000-0000000000ef';
begin
  -- a new account with an obscene name starts with an empty name (the sign-up never fails)
  delete from profiles where id in (a1, a2);
  insert into profiles (id, full_name, username) values (a1, 'Сука Блять', 'xuy_228');
  insert into profiles (id, full_name) values (a2, 'Нұрлан Худайберген');
  perform t.ok((select full_name is null and username is null from profiles where id = a1), 'an obscene name at sign-up is dropped and the sign-up does not fail');
  perform t.ok((select full_name from profiles where id = a2) = 'Нұрлан Худайберген', 'a clean name is kept at sign-up');
  perform t.ok(t.raises(format($q$update profiles set full_name = 'Хуйло Иванов' where id = '%s'$q$, a2)) like '%inappropriate_text%', 'editing the name to an obscene one is refused');
  perform t.ok(t.raises(format($q$update profiles set username = 'pizda_2020' where id = '%s'$q$, a2)) like '%inappropriate_text%', 'the username too');
  perform t.ok(t.raises(format($q$update profiles set bio = 'я f u c k ер' where id = '%s'$q$, a2)) like '%inappropriate_text%', 'the bio too, even with spaces between the letters');
  perform t.ok(t.raises(format($q$update profiles set role_title = 'Student' where id = '%s'$q$, a2)) is null, 'an ordinary title is accepted');
  perform t.ok((select full_name from profiles where id = a2) = 'Нұрлан Худайберген', 'the refused edit changed nothing');
  -- a name that was already there is not re-checked when something else changes (an avatar, say)
  alter table profiles disable trigger profiles_check_text;
  update profiles set full_name = 'Сука' where id = a2;
  alter table profiles enable trigger profiles_check_text;
  perform t.ok(t.raises(format($q$update profiles set country = 'Kazakhstan' where id = '%s'$q$, a2)) is null, 'other columns can still change');
end $$;
