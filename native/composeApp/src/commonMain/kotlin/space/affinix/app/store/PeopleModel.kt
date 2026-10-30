package space.affinix.app.store

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.ktor.http.HttpMethod
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import space.affinix.app.net.Api
import space.affinix.app.net.AuthorRow
import space.affinix.app.net.Friendship
import space.affinix.app.net.FriendshipRow
import space.affinix.app.net.Person
import space.affinix.app.net.toPerson

/** Friends and people search: the website's Friends page (src/lib/friendsStore.js + people.js) over the same table, RPCs and view. */
class PeopleModel(private val api: Api, private val scope: CoroutineScope, private val me: () -> String?, private val feed: FeedModel) {
    var friends by mutableStateOf<List<Friendship>>(emptyList())
        private set
    var incoming by mutableStateOf<List<Friendship>>(emptyList())
        private set
    var outgoing by mutableStateOf<List<Friendship>>(emptyList())
        private set
    var loaded by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    var notice by mutableStateOf<String?>(null)

    var query by mutableStateOf("")
        private set
    var results by mutableStateOf<List<Person>>(emptyList())
        private set
    var searching by mutableStateOf(false)
        private set
    var searchFailed by mutableStateOf(false)
        private set

    private var searchJob: Job? = null
    private fun say(key: String) { notice = key; scope.launch { delay(3500); if (notice == key) notice = null } }

    // ---- friendships ------------------------------------------------------------------------------------------------------------------

    fun load() { scope.launch { loadNow() } }

    internal suspend fun loadNow() {
        val uid = me() ?: return
        failed = false
        try {
            val rows = api.restGet("friendships", ListSerializer(FriendshipRow.serializer()), "select" to "*", "or" to "(requester_id.eq.$uid,addressee_id.eq.$uid)")
            val others = feed.authors(rows.map { if (it.requesterId == uid) it.addresseeId else it.requesterId })
            val mapped = rows.map {
                val oid = if (it.requesterId == uid) it.addresseeId else it.requesterId
                Friendship(it.id, others[oid] ?: Person(oid, null, null, null), it.status, it.requesterId == uid, it.createdAt)
            }.sortedByDescending { it.createdAt }
            friends = mapped.filter { it.accepted }
            incoming = mapped.filter { it.status == "pending" && !it.iRequested }
            outgoing = mapped.filter { it.status == "pending" && it.iRequested }
            loaded = true
        } catch (e: CancellationException) { throw e } catch (e: Exception) { failed = true }
    }

    /** How a person relates to the viewer: the friendship if there is one. */
    fun relation(personId: String): Friendship? = (friends + incoming + outgoing).firstOrNull { it.other.id == personId }

    private fun act(block: suspend () -> Unit) {
        scope.launch {
            try { block(); loadNow() } catch (e: CancellationException) { throw e } catch (e: Exception) { say("app.noNetwork") }
        }
    }

    fun send(personId: String) = act { api.rpcText("send_friend_request", buildJsonObject { put("target_id", personId) }) }

    fun accept(f: Friendship) = act { api.rpcText("accept_friend_request", buildJsonObject { put("p_friendship_id", f.id) }); say("friends.requestAccepted") }

    /** decline, cancel and remove are the same thing underneath: delete a row you are a party to */
    fun remove(f: Friendship) = act { api.restWrite(HttpMethod.Delete, "friendships", listOf("id" to "eq.${f.id}")) }

    // ---- search ---------------------------------------------------------------------------------------------------------------------

    fun search(raw: String) {
        query = raw
        searchJob?.cancel()
        val q = clean(raw)
        if (q.length < MIN_QUERY) { results = emptyList(); searching = false; searchFailed = false; return }
        searchJob = scope.launch {
            delay(300) // a short pause in typing
            searching = true; searchFailed = false
            try { results = runSearch(q) } catch (e: CancellationException) { throw e } catch (e: Exception) { searchFailed = true } finally { searching = false }
        }
    }

    /** what was typed, reduced to something safe inside a pattern: no leading "@", no wildcards or quotes, single spaces, at most 40 characters */
    fun clean(raw: String): String = raw.replace(Regex("[\\u0000-\\u001f*\"\\\\]"), " ").trimStart('@', ' ').replace(Regex("\\s+"), " ").trim().take(40)

    private fun esc(s: String) = s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    internal suspend fun runSearch(q: String): List<Person> {
        val words = q.split(" ").take(4)
        val handle = q.replace(" ", "").lowercase()
        val cols = "id,full_name,username,avatar_url,role_title,bio"
        fun pat(w: String, prefix: Boolean = false) = "\"${if (prefix) "" else "*"}${esc(w)}*\""
        val ser = ListSerializer(AuthorRow.serializer())
        val byName = api.restGet(
            "profiles_public", ser, "select" to cols,
            "and" to "(${words.joinToString(",") { "full_name.ilike.${pat(it)}" }})", "order" to "full_name.asc", "limit" to MAX.toString(),
        )
        val byHandle = if (words.size == 1) {
            api.restGet("profiles_public", ser, "select" to cols, "username" to "ilike.${pat(handle, prefix = true)}", "order" to "username.asc", "limit" to MAX.toString()) +
                api.restGet("profiles_public", ser, "select" to cols, "username" to "ilike.${pat(handle)}", "order" to "username.asc", "limit" to MAX.toString())
        } else emptyList()
        val seen = LinkedHashMap<String, Person>()
        for (r in byName + byHandle) if (r.id != me()) seen.putIfAbsent(r.id, r.toPerson())
        return seen.values.sortedWith(compareBy<Person> { rank(it, q.lowercase(), handle) }.thenBy { it.name ?: "~" }).take(MAX)
    }

    /** exact @username first, then names that start with the text, then the rest */
    private fun rank(p: Person, q: String, handle: String): Int = when {
        p.username?.lowercase() == handle -> 0
        p.name?.lowercase()?.startsWith(q) == true -> 1
        p.username?.lowercase()?.startsWith(handle) == true -> 2
        else -> 3
    }

    companion object { const val MIN_QUERY = 2; const val MAX = 20 }
}
