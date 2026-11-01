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
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import space.affinix.app.net.Api
import space.affinix.app.net.ApiException
import space.affinix.app.net.ApiJson

@Serializable
private data class MeRow(@SerialName("is_admin") val isAdmin: Boolean = false, @SerialName("is_owner") val isOwner: Boolean = false)

@Serializable
private data class ContentRow(
    val id: String, @SerialName("author_id") val authorId: String = "", @SerialName("post_id") val postId: String? = null, val body: String = "",
    @SerialName("image_url") val imageUrl: String? = null, @SerialName("created_at") val createdAt: String = "",
)

@Serializable
private data class AuthorLite(val id: String, @SerialName("full_name") val fullName: String? = null, val username: String? = null, @SerialName("avatar_url") val avatarUrl: String? = null)

/**
 * The admin panel (platform administrators and the owner only), over the website's own database functions (migration 0025): how the platform is doing, who is on it
 * (the owner makes and removes administrators), what to moderate (reported crowd tests, the newest posts and comments) and what administrators did. The database decides who
 * may do what; this only asks and shows. Without the migration every call answers "updatePending", without being an admin "noAccess".
 */
class AdminModel(private val api: Api, private val scope: CoroutineScope, private val me: () -> String?) {
    enum class Tab { Overview, People, Moderation, Log }
    enum class Status { Idle, Loading, Ready, Error }

    class Overview(
        val users: Int, val newUsers7d: Int, val active7d: Int, val admins: Int, val posts: Int, val comments: Int, val messages7d: Int, val friendships: Int,
        val companies: Int, val experiments: Int, val responses: Int, val arenaPlayers: Int, val testsOpen: Int, val testsFlagged: Int,
    )
    class Person(
        val id: String, val name: String?, val username: String?, val email: String?, val avatarUrl: String?, val isAdmin: Boolean, val isOwner: Boolean, val joinedAt: String,
        val company: String?, val companyRole: String?, val posts: Int, val xp: Long,
    ) { val label: String get() = name?.takeIf { it.isNotBlank() } ?: username ?: email ?: "—" }
    class LogRow(val id: Long, val action: String, val at: String, val actor: String?, val target: String?, val excerpt: String?)
    class Day(val day: String, val players: Int, val votes: Int, val missions: Int, val avgMinutes: Double, val over1h: Int, val over3h: Int)
    class ArenaStats(val players: Int, val votes: Int, val tests: Int, val testVotes: Int, val days: List<Day>)
    class Flagged(val id: String, val title: String, val status: String, val reports: Int, val reasons: List<String>, val owner: String?)
    class Content(val id: String, val kind: String, val authorId: String, val author: space.affinix.app.net.Person, val body: String, val hasImage: Boolean, val createdAt: String, val postId: String? = null)

    // ---- who is asking ---------------------------------------------------------------------------------------------------------
    var isAdmin by mutableStateOf(false)
        private set
    var isOwner by mutableStateOf(false)
        private set
    var meLoaded by mutableStateOf(false)
        private set

    fun loadMe() {
        val uid = me() ?: return
        scope.launch {
            try {
                val row = api.restGet("profiles", ListSerializer(MeRow.serializer()), "select" to "is_admin,is_owner", "id" to "eq.$uid").firstOrNull()
                isAdmin = row?.isAdmin == true; isOwner = row?.isOwner == true
            } catch (e: CancellationException) { throw e } catch (e: Exception) { isAdmin = false; isOwner = false } // a database without migration 0025 has no such columns
            meLoaded = true
        }
    }

    var tab by mutableStateOf(Tab.Overview)

    /** "updatePending" (migration 0025 missing), "noAccess" (not an administrator), "offline" or "generic" */
    private fun codeOf(e: Exception): String {
        val m = e.message.orEmpty()
        return when {
            m.contains("not_admin") || (e is ApiException && e.status == 403) -> "noAccess"
            e is ApiException && (e.status == 404 || m.contains("Could not find the function", true) || m.contains("PGRST202")) -> "updatePending"
            e is ApiException -> "generic"
            else -> "offline"
        }
    }

    private fun num(e: JsonElement?): Int = (e as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.toDoubleOrNull()?.toLong()?.toInt() ?: 0
    private fun long(e: JsonElement?): Long = (e as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.toDoubleOrNull()?.toLong() ?: 0L
    private fun str(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
    private fun bool(e: JsonElement?): Boolean = (e as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content == "true"

    // ---- overview ------------------------------------------------------------------------------------------------------------------
    var overview by mutableStateOf<Overview?>(null)
        private set
    var overviewStatus by mutableStateOf(Status.Idle)
        private set
    var overviewError by mutableStateOf<String?>(null)
        private set
    var stats by mutableStateOf<ArenaStats?>(null)
        private set

    fun loadOverview() {
        overviewStatus = Status.Loading; overviewError = null
        scope.launch {
            try {
                val o = ApiJson.parseToJsonElement(api.rpcText("admin_overview")).jsonObject
                overview = Overview(
                    num(o["users"]), num(o["newUsers7d"]), num(o["active7d"]), num(o["admins"]), num(o["posts"]), num(o["comments"]), num(o["messages7d"]), num(o["friendships"]),
                    num(o["companies"]), num(o["experiments"]), num(o["responses"]), num(o["arenaPlayers"]), num(o["testsOpen"]), num(o["testsFlagged"]),
                )
                overviewStatus = Status.Ready
            } catch (e: CancellationException) { throw e } catch (e: Exception) { overviewError = codeOf(e); overviewStatus = Status.Error; return@launch }
            // the Arena's usage numbers are a bonus: the overview stands without them
            try {
                val s = ApiJson.parseToJsonElement(api.rpcText("arena_admin_stats", buildJsonObject { put("p_days", 14) })).jsonObject
                stats = ArenaStats(
                    num(s["players"]), num(s["votes"]), num(s["tests"]), num(s["testVotes"]),
                    s["days"]?.jsonArray.orEmpty().map { d -> val o = d.jsonObject; Day(str(o["day"]).orEmpty(), num(o["players"]), num(o["votes"]), num(o["missions"]), (o["avgMinutes"] as? JsonPrimitive)?.content?.toDoubleOrNull() ?: 0.0, num(o["over1h"]), num(o["over3h"])) },
                )
            } catch (e: CancellationException) { throw e } catch (e: Exception) { stats = null }
        }
    }

    // ---- people ------------------------------------------------------------------------------------------------------------------
    var people by mutableStateOf<List<Person>>(emptyList())
        private set
    var peopleTotal by mutableStateOf(0)
        private set
    var peopleStatus by mutableStateOf(Status.Idle)
        private set
    var peopleError by mutableStateOf<String?>(null)
        private set
    var loadingMore by mutableStateOf(false)
        private set
    var peopleQuery by mutableStateOf("")
        private set
    /** the locale key of the last result of a grant / revoke (shown once) */
    var notice by mutableStateOf<String?>(null)
    var busyId by mutableStateOf<String?>(null)
        private set

    private var searchJob: Job? = null

    /** the box is read after a short pause in typing */
    fun search(text: String) {
        peopleQuery = text
        searchJob?.cancel()
        searchJob = scope.launch { delay(300); loadPeople() }
    }

    fun loadPeople() {
        peopleStatus = Status.Loading; peopleError = null
        val q = peopleQuery.trim()
        scope.launch {
            try {
                val rows = fetchPeople(q, 0)
                if (q == peopleQuery.trim()) { people = rows; peopleTotal = totalOf; peopleStatus = Status.Ready }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { peopleError = codeOf(e); peopleStatus = Status.Error }
        }
    }

    fun loadMore() {
        if (loadingMore || people.size >= peopleTotal) return
        loadingMore = true
        val q = peopleQuery.trim()
        scope.launch {
            try {
                val more = fetchPeople(q, people.size)
                if (q == peopleQuery.trim()) { people = people + more.filter { m -> people.none { it.id == m.id } }; peopleTotal = totalOf }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { notice = "admin.errorBody" }
            loadingMore = false
        }
    }

    private var totalOf = 0

    private suspend fun fetchPeople(q: String, offset: Int): List<Person> {
        val arr = ApiJson.parseToJsonElement(api.rpcText("admin_users", buildJsonObject { put("p_query", q); put("p_limit", PAGE); put("p_offset", offset) })).jsonArray
        totalOf = arr.firstOrNull()?.jsonObject?.get("total")?.let { num(it) } ?: 0
        return arr.map { r ->
            val o = r.jsonObject
            Person(
                str(o["id"]).orEmpty(), str(o["full_name"]), str(o["username"]), str(o["email"]), str(o["avatar_url"]), bool(o["is_admin"]), bool(o["is_owner"]), str(o["created_at"]).orEmpty(),
                str(o["org_name"]), str(o["org_role"]), num(o["posts"]), long(o["xp"]),
            )
        }
    }

    /** Only the owner may do this (the database checks too). */
    fun setAdmin(p: Person, grant: Boolean) {
        busyId = p.id
        scope.launch {
            try {
                api.rpcText("admin_set_admin", buildJsonObject { put("p_user", p.id); put("p_admin", grant) })
                people = people.map { if (it.id == p.id) Person(it.id, it.name, it.username, it.email, it.avatarUrl, grant, it.isOwner, it.joinedAt, it.company, it.companyRole, it.posts, it.xp) else it }
                notice = if (grant) "admin.people.granted" else "admin.people.revoked"
                noticeName = p.label
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                val m = e.message.orEmpty()
                notice = "admin.people.err." + when {
                    m.contains("not_owner") -> "not_owner"; m.contains("is_owner") -> "is_owner"; m.contains("not_found") -> "not_found"; m.contains("not_admin") -> "not_admin"
                    codeOf(e) == "updatePending" -> "updatePending"; else -> "generic"
                }
            } finally { busyId = null }
        }
    }

    /** the name in the last grant / revoke message */
    var noticeName by mutableStateOf("")
        private set

    // ---- the log of what administrators did -----------------------------------------------------------------------------------
    var log by mutableStateOf<List<LogRow>>(emptyList())
        private set
    var logStatus by mutableStateOf(Status.Idle)
        private set
    var logError by mutableStateOf<String?>(null)
        private set

    fun loadLog() {
        logStatus = Status.Loading; logError = null
        scope.launch {
            try {
                log = ApiJson.parseToJsonElement(api.rpcText("admin_audit_list", buildJsonObject { put("p_limit", 60) })).jsonArray.map { r ->
                    val o = r.jsonObject
                    LogRow(long(o["id"]), str(o["action"]).orEmpty(), str(o["created_at"]).orEmpty(), str(o["actor_name"]), str(o["target_name"]), str((o["meta"] as? JsonObject)?.get("excerpt")))
                }
                logStatus = Status.Ready
            } catch (e: CancellationException) { throw e } catch (e: Exception) { logError = codeOf(e); logStatus = Status.Error }
        }
    }

    // ---- moderation ------------------------------------------------------------------------------------------------------------------
    var flagged by mutableStateOf<List<Flagged>>(emptyList())
        private set
    var posts by mutableStateOf<List<Content>>(emptyList())
        private set
    var comments by mutableStateOf<List<Content>>(emptyList())
        private set
    var moderationStatus by mutableStateOf(Status.Idle)
        private set
    var moderationError by mutableStateOf<String?>(null)
        private set
    var moderating by mutableStateOf<String?>(null)
        private set

    fun loadModeration() {
        moderationStatus = Status.Loading; moderationError = null
        scope.launch {
            // reported crowd tests: a server without migration 0022 simply has none
            flagged = try {
                ApiJson.parseToJsonElement(api.rpcText("arena_test_flagged")).let { it as? JsonArray }.orEmpty().map { x ->
                    val o = x.jsonObject
                    Flagged(str(o["id"]).orEmpty(), str(o["title"]).orEmpty(), str(o["status"]).orEmpty(), num(o["reports"]), (o["reasons"] as? JsonArray).orEmpty().mapNotNull { str(it) }, str((o["owner"] as? JsonObject)?.get("name")))
                }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { emptyList() }
            try {
                val ps = api.restGet("posts", ListSerializer(ContentRow.serializer()), "select" to "id,author_id,body,image_url,created_at", "order" to "created_at.desc", "limit" to "20")
                val cs = api.restGet("post_comments", ListSerializer(ContentRow.serializer()), "select" to "id,post_id,author_id,body,created_at", "order" to "created_at.desc", "limit" to "20")
                val ids = (ps.map { it.authorId } + cs.map { it.authorId }).distinct().filter { it.isNotEmpty() }
                val authors = if (ids.isEmpty()) emptyMap() else runCatching {
                    api.restGet("profiles_public", ListSerializer(AuthorLite.serializer()), "select" to "id,full_name,username,avatar_url", "id" to "in.(${ids.joinToString(",")})").associateBy { it.id }
                }.getOrDefault(emptyMap())
                fun content(kind: String, r: ContentRow) = Content(r.id, kind, r.authorId, authors[r.authorId].let { a -> space.affinix.app.net.Person(r.authorId, a?.fullName, a?.username, a?.avatarUrl) }, r.body, !r.imageUrl.isNullOrEmpty(), r.createdAt, r.postId)
                posts = ps.map { content("post", it) }; comments = cs.map { content("comment", it) }
                moderationStatus = Status.Ready
            } catch (e: CancellationException) { throw e } catch (e: Exception) { moderationError = codeOf(e); moderationStatus = Status.Error }
        }
    }

    /** An administrator removes someone else's post or comment (the database allows only administrators and writes the log). */
    fun removeContent(c: Content) {
        moderating = c.id
        scope.launch {
            try {
                api.restWrite(HttpMethod.Delete, if (c.kind == "post") "posts" else "post_comments", listOf("id" to "eq.${c.id}"))
                if (c.kind == "post") { posts = posts.filter { it.id != c.id }; comments = comments.filter { it.postId != c.id } } else comments = comments.filter { it.id != c.id }
                notice = "admin.moderation.removed"
            } catch (e: CancellationException) { throw e } catch (e: Exception) { notice = "admin.errorBody" }
            finally { moderating = null }
        }
    }

    /** a reported crowd test: "remove" or "restore" */
    fun moderateTest(f: Flagged, action: String) {
        moderating = f.id
        scope.launch {
            try {
                api.rpcText("arena_test_moderate", buildJsonObject { put("p_test", f.id); put("p_action", action) })
                loadModeration()
            } catch (e: CancellationException) { throw e } catch (e: Exception) { notice = "crowd.err.generic" }
            finally { moderating = null }
        }
    }

    companion object { const val PAGE = 30 }
}
