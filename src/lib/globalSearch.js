// Search across the whole platform: pages, people and public posts. Nothing private is searched: not a person's own
// experiments, results, messages or saved items (those have their own pages). People come from `profiles_public`
// (name / @username only), posts from the community feed every signed-in member can already read.
import { requireSupabase } from "./supabaseClient.js";
import { withTimeout } from "./async.js";
import { searchPeople, MIN_QUERY } from "./people.js";
import { fetchAuthorsById } from "./postsStore.js";

export const MIN_TEXT = MIN_QUERY;
const POSTS_LIMIT = 5;
const PEOPLE_LIMIT = 5;

/** What the person typed, safe inside an ILIKE pattern: wildcards and control characters out, "#" and "@" kept. */
export function cleanText(raw) {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f*%\\]/g, " ")
    .replace(/_/g, "\\_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** Pages whose name contains the text. `pages` = [{ id, label, path, icon }]. */
export function matchPages(pages, raw) {
  const q = String(raw ?? "").trim().toLowerCase();
  if (!q) return pages;
  return pages.filter((p) => p.label.toLowerCase().includes(q));
}

/** Newest public posts containing the text, each with its author. */
export async function searchPosts(raw) {
  const q = cleanText(raw);
  if (q.length < MIN_TEXT) return [];
  const sb = requireSupabase();
  const { data, error } = await withTimeout(
    sb.from("posts").select("id, author_id, body, created_at").ilike("body", `%${q}%`).order("created_at", { ascending: false }).limit(POSTS_LIMIT),
    12000
  );
  if (error) throw error;
  const rows = data ?? [];
  const authors = await fetchAuthorsById([...new Set(rows.map((r) => r.author_id))]).catch(() => ({}));
  return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at, author: authors[r.author_id] ?? null }));
}

/** { people, posts, failed } for the text; a group that fails comes back empty (failed counts them). */
export async function searchPlatform(raw) {
  const [people, posts] = await Promise.allSettled([searchPeople(raw), searchPosts(raw)]);
  return {
    people: people.status === "fulfilled" ? people.value.slice(0, PEOPLE_LIMIT) : [],
    posts: posts.status === "fulfilled" ? posts.value : [],
    failed: [people, posts].filter((r) => r.status === "rejected").length,
  };
}
