package space.affinix.app.net

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** [hint] is the short machine word a database function raises with (need_level, bad_title ...), when there is one */
class ApiException(val status: Int, override val message: String, val hint: String? = null) : Exception(message)

val ApiJson = Json { ignoreUnknownKeys = true; isLenient = true; explicitNulls = false; encodeDefaults = true }

/**
 * Supabase (GoTrue + PostgREST RPC) and the Vercel deal functions, the way the website uses them. All calls go through
 * [authed], which refreshes an expiring token once and retries a 401 once.
 */
class Api(
    private val http: HttpClient,
    val config: Config,
    private val store: SessionStore,
    private val nowSeconds: () -> Long = { space.affinix.app.Platform.nowMillis() / 1000 },
) {
    private val lock = Mutex()
    var session: Session? = store.load()
        private set

    // ---- auth ----------------------------------------------------------------

    suspend fun signIn(email: String, password: String): Session =
        token("password", buildJsonObject { put("email", email.trim()); put("password", password) })

    /** Returns the session, or null when the project wants the email confirmed first. */
    suspend fun signUp(email: String, password: String): Session? {
        val r = http.post("${config.supabaseUrl}/auth/v1/signup") {
            header("apikey", config.anonKey)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("email", email.trim()); put("password", password) }.toString())
        }
        val text = r.bodyAsText()
        if (!r.status.isSuccess()) throw ApiException(r.status.value, errorOf(text, r.status.value))
        val t = ApiJson.decodeFromString(TokenResponse.serializer(), text)
        return if (t.accessToken != null) adopt(t) else null
    }

    suspend fun recover(email: String) {
        val r = http.post("${config.supabaseUrl}/auth/v1/recover") {
            header("apikey", config.anonKey)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("email", email.trim()) }.toString())
        }
        if (!r.status.isSuccess()) throw ApiException(r.status.value, errorOf(r.bodyAsText(), r.status.value))
    }

    suspend fun signOut() {
        val s = session
        setSession(null)
        if (s != null) runCatching {
            http.post("${config.supabaseUrl}/auth/v1/logout") { header("apikey", config.anonKey); header(HttpHeaders.Authorization, "Bearer ${s.accessToken}") }
        }
    }

    /** The address that starts Google sign-in at Supabase and comes back to [redirect] with a one-time code (PKCE). */
    fun googleUrl(redirect: String, challenge: String): String =
        "${config.supabaseUrl}/auth/v1/authorize?provider=google&flow_type=pkce&code_challenge=$challenge&code_challenge_method=s256&redirect_to=${space.affinix.app.urlEncode(redirect)}"

    /** Sign in with Google through the system browser. Returns the session, or null when the player did not finish. */
    suspend fun signInWithGoogle(): Session? {
        val verifier = space.affinix.app.Pkce.verifier()
        val challenge = space.affinix.app.Pkce.challenge(verifier)
        val back = space.affinix.app.Browser.authorize { redirect -> googleUrl(redirect, challenge) } ?: return null
        back["error_description"]?.let { throw ApiException(400, it) }
        back["error"]?.let { throw ApiException(400, it) }
        val code = back["code"] ?: throw ApiException(400, "no code came back")
        return token("pkce", buildJsonObject { put("auth_code", code); put("code_verifier", verifier) })
    }

    private suspend fun token(grant: String, body: JsonObject): Session {
        val r = http.post("${config.supabaseUrl}/auth/v1/token") {
            parameter("grant_type", grant)
            header("apikey", config.anonKey)
            contentType(ContentType.Application.Json)
            setBody(body.toString())
        }
        val text = r.bodyAsText()
        if (!r.status.isSuccess()) throw ApiException(r.status.value, errorOf(text, r.status.value))
        return adopt(ApiJson.decodeFromString(TokenResponse.serializer(), text))
    }

    private fun adopt(t: TokenResponse): Session {
        val s = Session(
            accessToken = requireNotNull(t.accessToken) { "no access token" },
            refreshToken = t.refreshToken ?: session?.refreshToken ?: "",
            expiresAt = t.expiresAt ?: (nowSeconds() + t.expiresIn),
            userId = t.user?.id ?: session?.userId ?: "",
            email = t.user?.email ?: session?.email ?: "",
        )
        setSession(s)
        return s
    }

    private fun setSession(s: Session?) { session = s; store.save(s) }

    /** Refreshes the token when it is about to expire (or [force]); one refresh at a time. */
    private suspend fun fresh(force: Boolean = false): Session = lock.withLock {
        val s = session ?: throw ApiException(401, "signed out")
        if (!force && s.expiresAt - nowSeconds() > 30) return s
        try {
            token("refresh_token", buildJsonObject { put("refresh_token", s.refreshToken) })
        } catch (e: ApiException) {
            if (e.status in 400..401) setSession(null) // the refresh token is dead: the user has to sign in again
            throw e
        }
    }

    // ---- RPC -------------------------------------------------------------------

    /** One authenticated call to Supabase (RPC or table). A token about to expire is refreshed first; a 401 is retried once with a fresh token. */
    private suspend fun send(
        method: HttpMethod, url: String, query: List<Pair<String, String>> = emptyList(), body: String? = null, extra: Map<String, String> = emptyMap(),
        raw: ByteArray? = null, rawMime: String = "application/octet-stream",
    ): String {
        var s = fresh()
        var retried = false
        while (true) {
            val r = http.request(url) {
                this.method = method
                query.forEach { parameter(it.first, it.second) }
                header("apikey", config.anonKey)
                header(HttpHeaders.Authorization, "Bearer ${s.accessToken}")
                extra.forEach { header(it.key, it.value) }
                if (body != null) { contentType(ContentType.Application.Json); setBody(body) }
                if (raw != null) { contentType(ContentType.parse(rawMime)); setBody(raw) }
            }
            if (r.status.value == 401 && !retried) { retried = true; s = fresh(force = true); continue }
            val text = r.bodyAsText()
            if (!r.status.isSuccess()) throw ApiException(r.status.value, errorOf(text, r.status.value), hintOf(text))
            return text
        }
    }

    suspend fun rpcText(name: String, args: JsonElement = JsonObject(emptyMap())): String =
        send(HttpMethod.Post, "${config.supabaseUrl}/rest/v1/rpc/$name", body = args.toString())

    /** PostgREST table read: `restGet("posts", "select" to "*", "order" to "created_at.desc")`. Filters use PostgREST's own syntax (`"id" to "eq.5"`). */
    suspend fun restGet(table: String, vararg query: Pair<String, String>): String =
        send(HttpMethod.Get, "${config.supabaseUrl}/rest/v1/$table", query.toList())

    suspend fun <T> restGet(table: String, ser: KSerializer<T>, vararg query: Pair<String, String>): T = ApiJson.decodeFromString(ser, restGet(table, *query))

    /** insert (POST), update (PATCH) or delete (DELETE) on a table; [returning] true asks for the written rows back. */
    suspend fun restWrite(method: HttpMethod, table: String, query: List<Pair<String, String>> = emptyList(), body: JsonElement? = null, returning: Boolean = false): String =
        send(method, "${config.supabaseUrl}/rest/v1/$table", query, body?.toString(), mapOf("Prefer" to if (returning) "return=representation" else "return=minimal"))

    suspend fun <T> rpc(name: String, args: JsonElement, ser: KSerializer<T>): T = ApiJson.decodeFromString(ser, rpcText(name, args))

    /** Tags of the newest published releases of the project (no sign-in needed); drafts and pre-releases are left out. */
    suspend fun releaseTags(): List<String> {
        val r = http.get("https://api.github.com/repos/NUREKE178/affinix/releases?per_page=15") { header("Accept", "application/vnd.github+json") }
        val text = r.bodyAsText()
        if (!r.status.isSuccess()) throw ApiException(r.status.value, errorOf(text, r.status.value))
        return ApiJson.parseToJsonElement(text).jsonArray.map { it.jsonObject }
            .filter { it["draft"]?.jsonPrimitive?.content != "true" && it["prerelease"]?.jsonPrimitive?.content != "true" }
            .mapNotNull { it["tag_name"]?.jsonPrimitive?.content }
    }

    // ---- storage (pictures) ----------------------------------------------------------------------------------------------------

    private fun objectUrl(bucket: String, path: String) = "${config.supabaseUrl}/storage/v1/object/$bucket/$path"

    /** Uploads one file under [path] in [bucket]; the storage policies decide whether the path (it starts with the player's id) is allowed. */
    suspend fun uploadObject(bucket: String, path: String, bytes: ByteArray, mime: String) {
        send(HttpMethod.Post, objectUrl(bucket, path), extra = mapOf("cache-control" to "max-age=3600", "x-upsert" to "false"), raw = bytes, rawMime = mime)
    }

    /** Calls one of the website's Supabase edge functions as the signed-in person (invite-member ...). Returns the answer's text. */
    suspend fun invokeFunction(name: String, body: JsonObject): String = send(HttpMethod.Post, "${config.supabaseUrl}/functions/v1/$name", body = body.toString())

    fun publicObjectUrl(bucket: String, path: String) = "${config.supabaseUrl}/storage/v1/object/public/$bucket/$path"

    /** the storage path inside [bucket] of a public URL made by [publicObjectUrl], or null */
    fun pathFromPublicUrl(bucket: String, url: String?): String? {
        val marker = "/object/public/$bucket/"
        val i = url?.indexOf(marker) ?: -1
        return if (i < 0) null else url!!.substring(i + marker.length)
    }

    suspend fun removeObjects(bucket: String, paths: List<String>) {
        if (paths.isEmpty()) return
        send(HttpMethod.Delete, "${config.supabaseUrl}/storage/v1/object/$bucket", body = buildJsonObject { put("prefixes", JsonArray(paths.map { JsonPrimitive(it) })) }.toString())
    }

    /** Temporary links (an hour) to files of a private bucket; a path the server could not sign is left out of the answer. */
    suspend fun signedUrls(bucket: String, paths: List<String>): Map<String, String> {
        if (paths.isEmpty()) return emptyMap()
        val text = send(
            HttpMethod.Post, "${config.supabaseUrl}/storage/v1/object/sign/$bucket",
            body = buildJsonObject { put("expiresIn", 3600); put("paths", JsonArray(paths.map { JsonPrimitive(it) })) }.toString(),
        )
        val out = HashMap<String, String>()
        for (e in ApiJson.parseToJsonElement(text).jsonArray) {
            val o = e.jsonObject
            val path = o["path"]?.jsonPrimitive?.content ?: continue
            val signed = o["signedURL"]?.takeIf { it !is kotlinx.serialization.json.JsonNull }?.jsonPrimitive?.content ?: continue
            out[path] = "${config.supabaseUrl}/storage/v1$signed"
        }
        return out
    }

    suspend fun state(day: String, history: Int = 84): StateResponse =
        rpc("arena_state", buildJsonObject { put("p_day", day); put("p_history", history) }, StateResponse.serializer())

    /** [slate] (day, quest ids) is sent along when the server has none for the day yet. */
    suspend fun submit(votes: List<WireVote>, day: String, slate: Pair<String, List<String>>? = null): SubmitResponse =
        rpc(
            "arena_submit",
            buildJsonObject {
                put("p_votes", ApiJson.encodeToJsonElement(ListSerializer(WireVote.serializer()), votes))
                put("p_slices", JsonArray(emptyList()))
                if (slate == null) put("p_slate", JsonPrimitive(null as String?))
                else put("p_slate", buildJsonObject { put("day", slate.first); put("ids", JsonArray(slate.second.map { JsonPrimitive(it) })) })
                put("p_day", day)
            },
            SubmitResponse.serializer(),
        )

    suspend fun claim(day: String, quest: String): ClaimResponse =
        rpc("arena_claim", buildJsonObject { put("p_day", day); put("p_quest", quest) }, ClaimResponse.serializer())

    suspend fun tallies(items: List<TallyQuery>): List<Tally> =
        rpc("arena_tallies", buildJsonObject { put("p_items", ApiJson.encodeToJsonElement(ListSerializer(TallyQuery.serializer()), items)) }, ListSerializer(Tally.serializer()))

    /** Every (pair, dim) the player has answered in [season]: what a new device must know not to deal the same duel twice. */
    suspend fun myVotes(season: String): List<Pair<String, String>> {
        val out = ArrayList<Pair<String, String>>()
        var after = 0L
        for (page in 0 until 12) {
            val res = rpc("arena_my_votes", buildJsonObject { put("p_season", season); put("p_after", after); put("p_limit", 5000) }, MyVotes.serializer())
            for (row in res.rows) {
                val pair = (row.getOrNull(0) as? JsonPrimitive)?.content ?: continue
                val dim = (row.getOrNull(1) as? JsonPrimitive)?.content ?: continue
                out += pair to dim
            }
            after = res.last
            if (!res.more) break
        }
        return out
    }

    /** Every answer of [season] as (pair, dim, pick); pick 0 = the specimen with the lower index. */
    suspend fun myVoteRows(season: String): List<Triple<String, String, Int>> {
        val out = ArrayList<Triple<String, String, Int>>()
        var after = 0L
        for (page in 0 until 12) {
            val res = rpc("arena_my_votes", buildJsonObject { put("p_season", season); put("p_after", after); put("p_limit", 5000) }, MyVotes.serializer())
            for (row in res.rows) {
                val pair = (row.getOrNull(0) as? JsonPrimitive)?.content ?: continue
                val dim = (row.getOrNull(1) as? JsonPrimitive)?.content ?: continue
                val pick = (row.getOrNull(2) as? JsonPrimitive)?.content?.toIntOrNull() ?: continue
                out += Triple(pair, dim, pick)
            }
            after = res.last
            if (!res.more) break
        }
        return out
    }

    /** The measured taste traits of specimens (season, family, index) -> seven numbers in the order of Taste.TRAITS; asked of the same generator the website uses. */
    suspend fun traits(items: List<Triple<String, String, Int>>): Map<String, DoubleArray> {
        val body = buildJsonObject { put("items", JsonArray(items.map { JsonArray(listOf(JsonPrimitive(it.first), JsonPrimitive(it.second), JsonPrimitive(it.third))) })) }
        val r = http.post(config.apiBase + "/api/arena-traits") { contentType(ContentType.Application.Json); setBody(body.toString()) }
        val text = r.bodyAsText()
        if (!r.status.isSuccess()) throw ApiException(r.status.value, errorOf(text, r.status.value))
        val obj = ApiJson.parseToJsonElement(text).jsonObject["traits"]?.jsonObject ?: throw ApiException(200, "unexpected answer: " + text.take(120))
        return obj.mapValues { (_, v) -> v.jsonArray.map { it.jsonPrimitive.double }.toDoubleArray() }
    }

    suspend fun leaderboard(scope: String, friends: Boolean = false): Leaderboard =
        rpc("arena_leaderboard", buildJsonObject { put("p_scope", scope); put("p_friends", friends) }, Leaderboard.serializer())

    // ---- the deal functions (no login needed) -------------------------------------

    suspend fun dealDaily(day: String, season: String): List<Duel> = get("/api/arena-deal", "kind" to "daily", "day" to day, "season" to season)

    suspend fun dealSet(n: Int, day: String, season: String): List<Duel> = get("/api/arena-deal", "kind" to "set", "n" to n.toString(), "day" to day, "season" to season)

    suspend fun dealFree(day: String, season: String, seed: Long, seen: List<Pair<String, String>>, recent: JsonElement = JsonArray(emptyList())): List<Duel> {
        val body = buildJsonObject {
            put("kind", "free"); put("day", day); put("season", season); put("seed", seed)
            put("seen", JsonArray(seen.map { JsonArray(listOf(JsonPrimitive(it.first), JsonPrimitive(it.second))) }))
            put("recent", recent)
        }
        val r = http.post(config.apiBase + "/api/arena-deal") { contentType(ContentType.Application.Json); setBody(body.toString()) }
        return decodeDuels(r)
    }

    private suspend fun get(path: String, vararg q: Pair<String, String>): List<Duel> =
        decodeDuels(http.get(config.apiBase + path) { q.forEach { parameter(it.first, it.second) } })

    private suspend fun decodeDuels(r: HttpResponse): List<Duel> {
        val text = r.bodyAsText()
        if (!r.status.isSuccess()) throw ApiException(r.status.value, errorOf(text, r.status.value))
        return parseDuels(text)
    }

    /** Any public file (an avatar, a post picture), no login. */
    suspend fun fetchBytes(url: String): ByteArray {
        val r = http.get(url)
        if (!r.status.isSuccess()) throw ApiException(r.status.value, "file ${r.status.value}")
        return r.body()
    }

    /** URL of the PNG of one specimen (the family/index are the duel's `a` or `b`). */
    fun specimenUrl(season: String, family: String, index: Int, width: Int = 640) =
        "${config.apiBase}/api/arena-specimen?season=$season&family=$family&index=$index&w=$width&v=1"

    suspend fun specimenPng(season: String, family: String, index: Int, width: Int = 640): ByteArray {
        val r = http.get(specimenUrl(season, family, index, width))
        if (!r.status.isSuccess()) throw ApiException(r.status.value, "specimen ${r.status.value}")
        return r.body()
    }

    private fun hintOf(text: String): String? = runCatching { ((ApiJson.parseToJsonElement(text) as JsonObject)["hint"] as? JsonPrimitive)?.content?.takeIf { it.isNotBlank() } }.getOrNull()

    private fun errorOf(text: String, status: Int): String = runCatching {
        val o = ApiJson.parseToJsonElement(text) as JsonObject
        listOf("error_description", "msg", "message", "error").firstNotNullOfOrNull { (o[it] as? JsonPrimitive)?.content?.takeIf(String::isNotBlank) }
    }.getOrNull() ?: "HTTP $status"
}

/** The dealer answers `{"duels":[...]}`; a bare array is read too. Anything else is reported as what it is (a web page, a platform error). */
fun parseDuels(text: String): List<Duel> = try {
    val el = ApiJson.parseToJsonElement(text)
    val arr = (el as? JsonObject)?.get("duels") ?: el
    ApiJson.decodeFromJsonElement(ListSerializer(Duel.serializer()), arr)
} catch (e: kotlinx.serialization.SerializationException) {
    throw ApiException(200, "unexpected answer: " + text.replace(Regex("\\s+"), " ").take(120))
} catch (e: IllegalArgumentException) {
    throw ApiException(200, "unexpected answer: " + text.replace(Regex("\\s+"), " ").take(120))
}
