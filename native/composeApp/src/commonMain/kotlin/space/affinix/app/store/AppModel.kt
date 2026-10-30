package space.affinix.app.store

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.put
import org.jetbrains.compose.resources.ExperimentalResourceApi
import org.jetbrains.compose.resources.decodeToImageBitmap
import space.affinix.app.Platform
import space.affinix.app.i18n.Lang
import space.affinix.app.i18n.tr
import space.affinix.app.localDay
import space.affinix.app.net.Api
import space.affinix.app.net.ApiException
import space.affinix.app.net.DayStats
import space.affinix.app.net.Duel
import space.affinix.app.net.KeyValueStore
import space.affinix.app.net.Leaderboard
import space.affinix.app.net.MyProfileRow
import space.affinix.app.net.Profile
import space.affinix.app.net.Tally
import space.affinix.app.net.TallyQuery
import space.affinix.app.net.WireVote
import space.affinix.app.seasonOf

enum class Tab { Play, Feed, Chats, People, Rankings, Profile }

/** Everything the screens read. Plain Compose state, so a screen recomposes when a value here changes. */
class AppModel(
    val api: Api,
    private val scope: CoroutineScope,
    private val kv: KeyValueStore,
) {
    var signedIn by mutableStateOf(api.session != null)
        private set
    var lang by mutableStateOf(Lang.of(kv.get("lang")) ?: Lang.of(Platform.languageTag()) ?: Lang.Ru)
        private set
    var tab by mutableStateOf(Tab.Play)
    var profile by mutableStateOf<Profile?>(null)
        private set
    var today by mutableStateOf<DayStats?>(null)
        private set
    var loading by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
    var offline by mutableStateOf(false)
        private set
    var leaderboard by mutableStateOf<Leaderboard?>(null)
        private set
    var leaderboardScope by mutableStateOf("week")
        private set
    var leaderboardFailed by mutableStateOf(false)
        private set
    var autoNext by mutableStateOf(false)

    /** my own `profiles` row, for the edit form */
    var myProfile by mutableStateOf<MyProfileRow?>(null)
        private set

    /** specimen PNGs by "season/family/index" */
    val images = mutableStateMapOf<String, ImageBitmap>()
    val imageFailed = mutableStateMapOf<String, Boolean>()

    private val seen = HashSet<String>()
    private var seenLoaded = false

    val game = Game(
        object : Game.Sink {
            override suspend fun tallies(items: List<TallyQuery>): List<Tally> = api.tallies(items)
            override suspend fun submit(votes: List<WireVote>, day: String) { api.submit(votes, day) }
        },
    )

    var feed by mutableStateOf(FeedModel(api, scope) { api.session?.userId })
        private set
    var people by mutableStateOf(PeopleModel(api, scope, { api.session?.userId }, feed))
        private set
    var messages by mutableStateOf(MessagesModel(api, scope, { api.session?.userId }, feed))
        private set

    /** a signed-out player's posts, friends and chats must not show for the next one */
    private fun freshSocial() {
        feed = FeedModel(api, scope) { api.session?.userId }
        people = PeopleModel(api, scope, { api.session?.userId }, feed)
        messages = MessagesModel(api, scope, { api.session?.userId }, feed)
    }

    val email get() = api.session?.email.orEmpty()
    fun text(key: String, vararg vars: Pair<String, Any>) = tr(lang, key, *vars)

    init { if (signedIn) refresh() }

    fun changeLang(l: Lang) { lang = l; kv.put("lang", l.tag) }

    // ---- auth ----------------------------------------------------------------------

    /** Returns null on success, or the message to show. [register] true creates the account. */
    suspend fun authenticate(email: String, password: String, register: Boolean): String? = guard {
        if (register) {
            val s = api.signUp(email, password)
            if (s == null) return@guard "CONFIRM"
        } else api.signIn(email, password)
        signedIn = true
        refresh()
        null
    }

    suspend fun recover(email: String): String? = guard { api.recover(email); null }

    fun signOut() {
        scope.launch { api.signOut() }
        signedIn = false
        profile = null; today = null; leaderboard = null
        game.end()
        seen.clear(); seenLoaded = false
        freshSocial()
        tab = Tab.Play
    }

    private suspend fun guard(block: suspend () -> String?): String? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: ApiException) {
        e.message
    } catch (e: Exception) {
        text("app.noNetwork")
    }

    // ---- home ------------------------------------------------------------------------

    fun refresh() {
        scope.launch {
            loading = true
            try {
                val st = api.state(localDay())
                profile = st.profile; today = st.today
                offline = false
                loadSeen()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (e.status == 401) { signedIn = false; return@launch }
                offline = true
            } catch (e: Exception) {
                offline = true
            } finally {
                loading = false
            }
        }
    }

    private suspend fun loadSeen() {
        if (seenLoaded) return
        val season = seasonOf()
        val prev = prevSeason(season)
        for (s in listOf(prev, season)) for ((pair, dim) in runCatching { api.myVotes(s) }.getOrDefault(emptyList())) seen += "$pair|$dim"
        seenLoaded = true
    }

    private fun prevSeason(season: String): String {
        val y = season.substring(0, 4).toInt(); val m = season.substring(4).toInt()
        return if (m == 1) "${y - 1}12" else "$y${(m - 1).toString().padStart(2, '0')}"
    }

    val dailyDone: Int get() = (today?.dailyVotes ?: 0).coerceAtMost(space.affinix.app.Rules.DAILY_SET_SIZE)
    val dailyComplete: Boolean get() = dailyDone >= space.affinix.app.Rules.DAILY_SET_SIZE

    // ---- rounds ------------------------------------------------------------------------

    fun startDaily() = startRound(Mode.Daily)
    fun startFree() = startRound(Mode.Free)

    private fun startRound(mode: Mode) {
        if (loading) return
        scope.launch {
            loading = true; error = null
            try {
                val day = localDay(); val season = seasonOf()
                val duels = if (mode == Mode.Daily) {
                    api.dealDaily(day, season).filter { "${it.pair}|${it.dim}" !in seen }
                } else {
                    val seed = Platform.nowMillis() xor (Platform.uuid().hashCode().toLong() shl 7)
                    api.dealFree(day, season, seed and 0xFFFFFFFFL, seen.map { it.substringBefore('|') to it.substringAfter('|') })
                }
                if (duels.isEmpty()) { game.end(); return@launch }
                game.start(mode, duels)
                scope.launch { game.loadTallies() }
                duels.take(2).forEach { ensureImages(it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                error = e.message
            } catch (e: Exception) {
                error = text("app.noNetwork")
            } finally {
                loading = false
            }
        }
    }

    fun imageKey(d: Duel, index: Int) = "${d.season}/${d.family}/$index"

    @OptIn(ExperimentalResourceApi::class)
    fun ensureImages(d: Duel) {
        for (i in listOf(d.a, d.b)) {
            val k = imageKey(d, i)
            if (images.containsKey(k)) continue
            imageFailed.remove(k)
            scope.launch {
                try {
                    images[k] = api.specimenPng(d.season, d.family, i).decodeToImageBitmap()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    imageFailed[k] = true
                }
            }
        }
    }

    /** A picture by URL (avatars, post photos), loaded once and kept in [images]. */
    @OptIn(ExperimentalResourceApi::class)
    fun ensureUrlImage(url: String?) {
        if (url.isNullOrBlank() || images.containsKey(url) || imageFailed[url] == true) return
        scope.launch {
            try { images[url] = api.fetchBytes(url).decodeToImageBitmap() }
            catch (e: CancellationException) { throw e } catch (e: Exception) { imageFailed[url] = true }
        }
    }

    fun vote(side: Int) {
        game.vote(side)
        game.round.value?.last?.let { seen += "${it.duel.pair}|${it.duel.dim}" }
        scheduleFlush()
        if (autoNext) scope.launch { delay(1400); next() }
    }

    fun next() {
        game.next()
        val r = game.round.value ?: return
        r.duels.getOrNull(r.idx + 1)?.let { ensureImages(it) }
        if (r.phase == Phase.Summary) { scope.launch { game.flush(); refreshAfterRound() } }
    }

    fun skip() {
        game.skip()
        val r = game.round.value ?: return
        r.duels.getOrNull(r.idx + 1)?.let { ensureImages(it) }
        if (r.phase == Phase.Summary) { scope.launch { game.flush(); refreshAfterRound() } }
    }

    fun endRound() { scope.launch { game.flush() }; game.end(); refresh() }

    private suspend fun refreshAfterRound() {
        runCatching { api.state(localDay()) }.getOrNull()?.let { profile = it.profile; today = it.today }
    }

    private var flushJob: Job? = null
    private fun scheduleFlush() {
        flushJob?.cancel()
        flushJob = scope.launch { delay(3500); offline = !game.flush() }
    }

    // ---- my profile ------------------------------------------------------------------------------------------------------------------

    fun loadMyProfile() {
        val uid = api.session?.userId ?: return
        scope.launch {
            try {
                myProfile = api.restGet("profiles", kotlinx.serialization.builtins.ListSerializer(MyProfileRow.serializer()), "select" to "full_name,username,role_title,bio", "id" to "eq.$uid").firstOrNull()
            } catch (e: CancellationException) { throw e } catch (e: Exception) { /* the form just stays empty */ }
        }
    }

    /** Same rule as the website: 3-30 of a-z, 0-9, _ (or empty). */
    fun usernameOk(u: String) = u.isEmpty() || Regex("^[a-z0-9_]{3,30}$").matches(u)

    /** Returns null when saved, or the strings key of what went wrong. */
    suspend fun saveMyProfile(name: String, username: String, role: String, bio: String): String? {
        val uid = api.session?.userId ?: return "app.noNetwork"
        val u = username.trim().lowercase()
        if (!usernameOk(u)) return "profile.personal.usernameInvalid"
        return try {
            api.restWrite(
                io.ktor.http.HttpMethod.Patch, "profiles", listOf("id" to "eq.$uid"),
                kotlinx.serialization.json.buildJsonObject {
                    put("full_name", name.trim()); put("username", if (u.isEmpty()) kotlinx.serialization.json.JsonNull else kotlinx.serialization.json.JsonPrimitive(u))
                    put("role_title", role.trim()); put("bio", bio.trim())
                },
            )
            myProfile = MyProfileRow(name.trim(), u.ifEmpty { null }, role.trim(), bio.trim())
            null
        } catch (e: CancellationException) { throw e } catch (e: ApiException) {
            if (e.status == 409 || e.message.contains("duplicate", true) || e.message.contains("unique", true)) "profile.personal.usernameTaken" else "app.noNetwork"
        } catch (e: Exception) { "app.noNetwork" }
    }

    /** Show me in the rankings or not (arena_set_visibility); put back when the server says no. */
    fun setVisible(v: Boolean) {
        val before = profile ?: return
        profile = before.copy(visible = v)
        scope.launch {
            try { api.rpcText("arena_set_visibility", kotlinx.serialization.json.buildJsonObject { put("p_visible", v) }) }
            catch (e: CancellationException) { throw e } catch (e: Exception) { profile = profile?.copy(visible = before.visible); error = text("arena.rankings.saveFailed") }
        }
    }

    // ---- rankings ------------------------------------------------------------------------

    fun loadLeaderboard(scopeId: String = leaderboardScope) {
        leaderboardScope = scopeId
        scope.launch {
            leaderboardFailed = false
            try { leaderboard = api.leaderboard(scopeId) } catch (e: CancellationException) { throw e } catch (e: Exception) { leaderboardFailed = true }
        }
    }
}
