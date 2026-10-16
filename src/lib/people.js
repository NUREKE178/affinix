// The people directory: find someone by name or @username, and turn the many
// "author-like" objects around the app (post author, comment author, friend,
// notification actor, leaderboard row, conversation, team member) into one
// person shape.
//
// Everything here reads `profiles_public` (migrations 0011 + 0013), the
// identity-only view the Feed already uses for every signed-in member: name,
// @username, avatar, role and bio. Never e-mail, and never readable by anon.
import { useState, useEffect } from "./preact.js";
import { requireSupabase } from "./supabaseClient.js";
import { withTimeout } from "./async.js";
import { fetchAuthorsById } from "./postsStore.js";

export const MIN_QUERY = 2;
export const MAX_RESULTS = 20;
const COLUMNS = "id, full_name, username, avatar_url, role_title, bio";

const present = (...values) => values.find((v) => v != null && v !== "") ?? null;

/** One person shape for the whole app: { id, name, username, avatarUrl, roleTitle, bio }.
 * Accepts that shape itself, a profiles_public row, or any of the prefixed
 * shapes the stores produce (author*, other*, actor*, a leaderboard row's
 * userId). The id keys are tried most-specific first on purpose: a
 * notification, friendship or team row also has an `id` of its own, and it is
 * NOT the person's. */
export function toPerson(x) {
  if (!x) return null;
  return {
    id: present(x.userId, x.authorId, x.otherId, x.actorId, x.id),
    name: present(x.name, x.full_name, x.authorName, x.otherName, x.actorName),
    username: present(x.username, x.authorUsername, x.otherUsername, x.actorUsername),
    avatarUrl: present(x.avatarUrl, x.avatar_url, x.authorAvatarUrl, x.otherAvatarUrl, x.actorAvatarUrl),
    roleTitle: present(x.roleTitle, x.role_title, x.authorRoleTitle, x.otherRoleTitle),
    bio: present(x.bio, x.authorBio, x.otherBio),
  };
}

/** What the person typed, reduced to something safe to put inside an ILIKE
 * pattern: no leading "@", no wildcards, single spaces, at most 40 characters. */
export function cleanQuery(raw) {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f*]/g, " ")
    .replace(/^[@\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

/** "%" and "_" are wildcards in LIKE, and "_" is legal in a username. */
const likeEscape = (s) => s.replace(/[\\%_]/g, "\\$&");

// Short-lived memory of people already seen (search results, opened profiles),
// so opening a profile twice, or right after finding someone, costs nothing.
const CACHE_MS = 60_000;
const cache = new Map();
function remember(person) {
  if (person?.id) cache.set(person.id, { at: Date.now(), person });
}
export function cachedPerson(id) {
  const hit = cache.get(id);
  return hit && Date.now() - hit.at < CACHE_MS ? hit.person : null;
}

/** The authoritative row for one person, or null when there is no such profile. */
export async function fetchPerson(id) {
  if (!id) return null;
  const hit = cachedPerson(id);
  if (hit) return hit;
  const rows = await withTimeout(fetchAuthorsById([id]), 10000); // a dropped connection must not leave the bio skeleton up forever
  const person = rows[id] ? toPerson(rows[id]) : null;
  remember(person);
  return person;
}

function rankOf(person, q, handle) {
  const user = (person.username ?? "").toLowerCase();
  const name = (person.name ?? "").toLowerCase();
  const ql = q.toLowerCase();
  if (user && user === handle) return 0;
  if (user && user.startsWith(handle)) return 1;
  if (name.startsWith(ql) || name.split(" ").some((w) => w.startsWith(ql.split(" ")[0]))) return 2;
  return 3;
}

/** People whose name contains every word typed, or whose @username starts
 * with / contains the text. Best match first: the exact @username, then
 * usernames that start with it, then names that start with it, then the rest.
 * Throws only when every query failed (a partial answer is still an answer). */
export async function searchPeople(raw) {
  const q = cleanQuery(raw);
  if (q.length < MIN_QUERY) return [];
  const sb = requireSupabase();
  const words = q.split(" ").slice(0, 4);
  const handle = q.replace(/ /g, "").toLowerCase(); // a username never contains a space
  const oneWord = words.length === 1;

  let byName = sb.from("profiles_public").select(COLUMNS);
  for (const w of words) byName = byName.ilike("full_name", `%${likeEscape(w)}%`);
  byName = byName.order("full_name", { ascending: true }).limit(MAX_RESULTS);
  const queries = [byName];
  if (oneWord) {
    // ordered, so an exact @username (a prefix of every longer one) always sorts first
    queries.push(sb.from("profiles_public").select(COLUMNS).ilike("username", `${likeEscape(handle)}%`).order("username", { ascending: true }).limit(MAX_RESULTS));
    queries.push(sb.from("profiles_public").select(COLUMNS).ilike("username", `%${likeEscape(handle)}%`).order("username", { ascending: true }).limit(MAX_RESULTS));
  }
  const answers = await withTimeout(Promise.all(queries), 12000);
  const failed = answers.filter((a) => a.error);
  if (failed.length === answers.length) throw failed[0].error;

  const byId = new Map();
  for (const a of answers) for (const row of a.data ?? []) if (!byId.has(row.id)) byId.set(row.id, toPerson(row));
  const people = [...byId.values()]
    .map((p) => ({ p, rank: rankOf(p, q, handle) }))
    .sort((a, b) => a.rank - b.rank || (a.p.name ?? "~").localeCompare(b.p.name ?? "~"))
    .slice(0, MAX_RESULTS)
    .map((x) => x.p);
  people.forEach(remember);
  return people;
}

const IDLE = { status: "idle", results: [], error: null };

/** { status: "idle" | "loading" | "ready" | "error", results, error } for the
 * text in a search box. Waits for a short pause in typing, ignores answers to
 * anything that is no longer the current text, and keeps the previous
 * results on screen while the next ones load. `retryKey` re-runs it. */
export function usePeopleSearch(query, retryKey = 0) {
  const [state, setState] = useState(IDLE);
  useEffect(() => {
    const q = cleanQuery(query);
    if (q.length < MIN_QUERY) { setState(IDLE); return undefined; }
    let live = true;
    setState((s) => ({ ...s, status: "loading", error: null }));
    const timer = setTimeout(() => {
      searchPeople(q)
        .then((results) => { if (live) setState({ status: "ready", results, error: null }); })
        .catch((error) => { if (live) setState({ status: "error", results: [], error }); });
    }, 260);
    return () => { live = false; clearTimeout(timer); };
  }, [query, retryKey]);
  return state;
}
