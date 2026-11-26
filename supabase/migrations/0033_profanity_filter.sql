-- ============================================================================
-- Affinix: no obscene words in the names people give themselves
--
-- is_profane(text) is the database twin of src/lib/profanity.js (read that header for the method; a test compares the word lists below with the
-- ones in the browser, so they cannot drift apart). A trigger on profiles applies it to full_name, username, role_title, bio and research_interests:
--   * a person EDITING their profile gets the error 'inappropriate_text' (the app shows it in their language);
--   * a new account (the row is made by the sign-up trigger, which must never fail) simply starts with an empty name instead.
-- Names already stored are not touched; they are only checked when changed.
-- Safe to run twice.
-- ============================================================================

create or replace function _profane_norm(t text, p_mode text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(
      case p_mode
        when 'cyr' then translate(lower(t), 'ёәіңғүұқөһaeopcxykmth03456', 'еаингууко' || 'х' || 'аеорсхукмтн' || 'озчсб')
        else translate(lower(t), '013457@$аеорсхукмтн', 'oieastas' || 'aeopcxykmth')
      end,
      '[0-9.,_\-+*/\\|''"`~!?:;()\[\]{}<>=#%^&@$ \t\r\n]', '', 'g'),
    '(.)\1+', '\1', 'g');
$$;

create or replace function is_profane(t text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_cyr_sub constant text[] := array['хуй', 'хуя', 'хуе', 'пизд', 'ебан', 'ебат', 'ебал', 'ебла', 'ебуч', 'ебыр', 'заеб', 'выеб', 'долбоеб', 'мудак', 'мудил', 'мудозв', 'пидор', 'пидар', 'пидрил', 'гандон', 'гондон', 'залуп', 'шлюх', 'блят', 'бляд', 'ублюд', 'сучар', 'говн', 'дерьм', 'дроч', 'сиктир', 'сиким', 'котак', 'амшык', 'жезокш'];
  v_cyr_exact constant text[] := array['бля', 'сука', 'суки', 'сучка', 'сучки', 'хер', 'жопа', 'жопу', 'чмо', 'лох', 'член', 'падла', 'тварь', 'мразь', 'урод', 'дебил', 'идиот', 'кретин', 'гнида'];
  v_lat_sub constant text[] := array['fuck', 'shit', 'bitch', 'whore', 'fagot', 'bastard', 'ashole', 'dickhead', 'motherf', 'cocksuck', 'pusy', 'penis', 'vagina', 'pizd', 'eban', 'yeban', 'blyat', 'siktir', 'zalup', 'mudak', 'pidor', 'pidar', 'gandon', 'gondon', 'dolboeb'];
  v_lat_exact constant text[] := array['dick', 'cock', 'tits', 'cunt', 'cunts', 'slut', 'sluts', 'niga', 'nigas', 'niger', 'nigers', 'fag', 'suka', 'blya', 'xuy', 'xyu', 'fuk', 'jopa', 'idiot', 'retard'];
  v_sep constant text := '[ \t\r\n.,_\-+*/\\|''"`~!?:;()\[\]{}<>=#%^&]+';
  tok text; c text; l text; s text;
  all_c text := ''; all_l text := '';
begin
  if t is null or btrim(t) = '' then return false; end if;
  foreach tok in array regexp_split_to_array(lower(t), v_sep) loop
    if tok = '' then continue; end if;
    c := _profane_norm(tok, 'cyr'); l := _profane_norm(tok, 'lat');
    all_c := all_c || c; all_l := all_l || l;
    if c <> '' then
      if c = any (v_cyr_exact) then return true; end if;
      foreach s in array v_cyr_sub loop if position(s in c) > 0 then return true; end if; end loop;
    end if;
    if l <> '' then
      if l = any (v_lat_exact) then return true; end if;
      foreach s in array v_lat_sub loop if position(s in l) > 0 then return true; end if; end loop;
    end if;
  end loop;
  -- spaced-out letters: only the longer stems
  foreach s in array v_cyr_sub loop if char_length(s) >= 4 and position(s in all_c) > 0 then return true; end if; end loop;
  foreach s in array v_lat_sub loop if char_length(s) >= 4 and position(s in all_l) > 0 then return true; end if; end loop;
  return false;
end
$$;

create or replace function profiles_check_text()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- the sign-up trigger makes this row: never fail it, just do not keep an obscene name
    if is_profane(new.full_name) then new.full_name := null; end if;
    if is_profane(new.username) then new.username := null; end if;
    return new;
  end if;
  if (new.full_name is distinct from old.full_name and is_profane(new.full_name))
     or (new.username is distinct from old.username and is_profane(new.username))
     or (new.role_title is distinct from old.role_title and is_profane(new.role_title))
     or (new.bio is distinct from old.bio and is_profane(new.bio))
     or (new.research_interests is distinct from old.research_interests and is_profane(array_to_string(new.research_interests, ' ')))
  then
    raise exception 'inappropriate_text';
  end if;
  return new;
end
$$;

drop trigger if exists profiles_check_text on profiles;
create trigger profiles_check_text before insert or update on profiles for each row execute function profiles_check_text();

notify pgrst, 'reload schema';
