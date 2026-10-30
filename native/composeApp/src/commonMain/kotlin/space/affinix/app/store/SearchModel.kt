package space.affinix.app.store

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import space.affinix.app.net.Api
import space.affinix.app.net.Person
import space.affinix.app.net.PostHitRow

/**
 * Search across the platform, like the website's top bar (src/lib/globalSearch.js): the screens of the app, people (name / @username from
 * `profiles_public`) and public posts. Nothing private is searched: not a person's messages, saved items or experiments.
 */
class SearchModel(private val api: Api, private val scope: CoroutineScope, private val feed: FeedModel, private val people: PeopleModel) {
    var query by mutableStateOf("")
        private set
    var persons by mutableStateOf<List<Person>>(emptyList())
        private set
    var posts by mutableStateOf<List<PostHit>>(emptyList())
        private set
    var searching by mutableStateOf(false)
        private set
    /** how many of the two groups (people, posts) could not be fetched */
    var failed by mutableStateOf(0)
        private set
    private var job: Job? = null

    fun type(raw: String) {
        query = raw
        job?.cancel()
        val q = cleanText(raw)
        if (q.length < MIN_TEXT) { persons = emptyList(); posts = emptyList(); searching = false; failed = 0; return }
        job = scope.launch {
            delay(300)
            searching = true
            try {
                val r = run(raw)
                persons = r.people; posts = r.posts; failed = r.failed
            } catch (e: CancellationException) { throw e } finally { searching = false }
        }
    }

    fun clear() = type("")

    class Result(val people: List<Person>, val posts: List<PostHit>, val failed: Int)

    /** both groups at once; a group that fails comes back empty and is counted in [Result.failed] */
    internal suspend fun run(raw: String): Result = coroutineScope {
        val p = async { runCatching { people.runSearch(people.clean(raw)).take(PEOPLE_LIMIT) } }
        val x = async { runCatching { searchPosts(raw) } }
        val pr = p.await(); val xr = x.await()
        pr.exceptionOrNull()?.let { if (it is CancellationException) throw it }
        xr.exceptionOrNull()?.let { if (it is CancellationException) throw it }
        Result(pr.getOrDefault(emptyList()), xr.getOrDefault(emptyList()), listOf(pr, xr).count { it.isFailure })
    }

    internal suspend fun searchPosts(raw: String): List<PostHit> {
        val q = cleanText(raw)
        if (q.length < MIN_TEXT) return emptyList()
        val rows = api.restGet(
            "posts", ListSerializer(PostHitRow.serializer()),
            "select" to "id,author_id,body,created_at", "body" to "ilike.*$q*", "order" to "created_at.desc", "limit" to POSTS_LIMIT.toString(),
        )
        val authors = runCatching { feed.authors(rows.map { it.authorId }) }.getOrDefault(emptyMap())
        return rows.map { PostHit(it.id, it.body, it.createdAt, authors[it.authorId]) }
    }

    companion object {
        const val MIN_TEXT = PeopleModel.MIN_QUERY
        const val POSTS_LIMIT = 5
        const val PEOPLE_LIMIT = 5

        /** what was typed, safe inside an ILIKE pattern: wildcards and control characters out, "#" and "@" kept (same rule as the website) */
        fun cleanText(raw: String): String = raw
            .replace(Regex("[\\u0000-\\u001f*%\\\\]"), " ")
            .replace("_", "\\_")
            .replace(Regex("\\s+"), " ")
            .trim()
            .take(60)

        /** the screens of the app whose name contains the text (all of them when the text is empty) */
        fun <T> matchPages(pages: List<Pair<String, T>>, raw: String): List<Pair<String, T>> {
            val q = raw.trim().lowercase()
            return if (q.isEmpty()) pages else pages.filter { it.first.lowercase().contains(q) }
        }
    }
}

data class PostHit(val id: String, val body: String, val createdAt: String, val author: Person?)
