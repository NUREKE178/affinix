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
import space.affinix.app.BuildInfo
import space.affinix.app.Rules
import space.affinix.app.Versions
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
import space.affinix.app.net.StateResponse
import space.affinix.app.net.Tally
import space.affinix.app.net.TallyQuery
import space.affinix.app.net.WireVote
import space.affinix.app.seasonOf

enum class Tab { Play, Quests, Feed, Chats, People, Rankings, Profile, Notifications, Search, Research }

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
    /** the recent days the server sent (the weekly theme adds up Monday to Sunday) */
    var days by mutableStateOf<Map<String, DayStats>>(emptyMap())
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
    var notifications by mutableStateOf(NotificationsModel(api, scope, { api.session?.userId }, feed))
        private set
    var search by mutableStateOf(SearchModel(api, scope, feed, people))
        private set
    var crowd by mutableStateOf(CrowdModel(api, scope, { api.session?.userId }, { profile?.xp ?: 0L }))
        private set

    /** a signed-out player's posts, friends and chats must not show for the next one */
    private fun freshSocial() {
        feed = FeedModel(api, scope) { api.session?.userId }
        people = PeopleModel(api, scope, { api.session?.userId }, feed)
        messages = MessagesModel(api, scope, { api.session?.userId }, feed)
        notifications = NotificationsModel(api, scope, { api.session?.userId }, feed)
        search = SearchModel(api, scope, feed, people)
        crowd = CrowdModel(api, scope, { api.session?.userId }, { profile?.xp ?: 0L })
    }

    val email get() = api.session?.email.orEmpty()
    fun text(key: String, vararg vars: Pair<String, Any>) = tr(lang, key, *vars)

    /** the version of a newer release when there is one (null otherwise); shown as a note with a link to the download page */
    var newerVersion by mutableStateOf<String?>(null)
        private set

    fun checkForUpdate() {
        scope.launch {
            try {
                val latest = Versions.newestNative(api.releaseTags())
                newerVersion = latest?.takeIf { Versions.isNewer(it, BuildInfo.VERSION) }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { /* offline or rate limited: no note */ }
        }
    }

    init { checkForUpdate(); if (signedIn) refresh() }

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

    /** Sign in with Google through the system browser (the same Supabase provider as the website). Null on success or when the player gave up, else the message to show. */
    suspend fun googleSignIn(): String? = guard {
        if (api.signInWithGoogle() == null) return@guard null
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
                adopt(api.state(localDay()))
                offline = false
                ensureSlate()
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

    /** every state the server sends keeps the profile, today and (when it carries them) the recent days that the weekly theme adds up */
    private fun adopt(st: StateResponse) {
        profile = st.profile
        today = st.today ?: today
        if (st.days.isNotEmpty()) days = st.days.associateBy { it.day }
        st.today?.let { days = days + (it.day to it) }
    }

    /** Today's three quests are stored on the server by whoever asks first (the website or this app) with the same rule, so both agree. */
    private suspend fun ensureSlate() {
        val uid = api.session?.userId ?: return
        val day = localDay()
        if ((today?.slate?.size ?: 0) >= 3) return
        runCatching {
            val res = api.submit(emptyList(), day, day to Rules.slateFor(uid, day))
            res.state?.let { adopt(it) }
        }
    }

    /** What today's quests are; empty until the server has them. */
    val quests: List<Rules.QuestDef> get() = today?.slate.orEmpty().mapNotNull { Rules.QUEST_BY_ID[it] }

    /** Claims a quest reward ("votes_15", "daily_set", "daily_clear"). Returns null when taken, or the strings key to show. */
    suspend fun claim(id: String): String? = try {
        val res = api.claim(localDay(), id)
        if (res.ok) { res.state?.let { adopt(it) }; null } else "arena.toast.claimRefused"
    } catch (e: CancellationException) { throw e } catch (e: Exception) { "app.noNetwork" }

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

    // ---- Stage 3: the marathon (extra sets of the day, theme of the week) ----------------------------------------------------

    data class SetEntry(val n: Int, val votes: Int, val size: Int, val done: Boolean, val claimed: Boolean, val bonus: Int)
    data class Theme(val family: String, val votes: Int, val goal: Int, val done: Boolean, val claimed: Boolean, val bonus: Int, val weekStart: String)

    /** a server without migration 0023 sends day rows without the set counters: the marathon is not offered then */
    val marathonReady: Boolean get() = today?.setVotes?.isNotEmpty() ?: true

    val sets: List<SetEntry> get() = Rules.EXTRA_SETS.map { n ->
        val v = (today?.setVotes?.getOrNull(n - 2) ?: 0).coerceAtMost(Rules.SET_SIZE)
        SetEntry(n, v, Rules.SET_SIZE, v >= Rules.SET_SIZE, today?.claimed?.contains(Rules.setQuestId(n)) == true, Rules.SET_BONUS)
    }

    /** sets open one after another once the day's ten are done */
    fun setOpen(n: Int): Boolean = dailyComplete && (n == 2 || sets.first { it.n == n - 1 }.done)

    val theme: Theme get() {
        val day = today?.day?.ifEmpty { null } ?: localDay()
        val monday = Rules.weekStart(day)
        val family = Rules.FAMILY_IDS[Rules.themeIndex(day, Rules.FAMILY_IDS.size)]
        val all = days + (today?.let { mapOf(it.day to it) } ?: emptyMap())
        var votes = 0; var claimed = false
        for (i in 0 until 7) {
            val d = all[Rules.addDays(monday, i)] ?: continue
            votes += d.familyVotes[family] ?: 0
            if (Rules.THEME_QUEST in d.claimed) claimed = true
        }
        return Theme(family, votes.coerceAtMost(Rules.THEME_GOAL), Rules.THEME_GOAL, votes >= Rules.THEME_GOAL, claimed, Rules.THEME_BONUS, monday)
    }

    /** this week's table among friends (arena_leaderboard with p_friends); null until loaded */
    var race by mutableStateOf<Leaderboard?>(null)
        private set
    var raceFailed by mutableStateOf(false)
        private set

    fun loadRace() {
        scope.launch {
            raceFailed = false
            try { race = api.leaderboard("week", friends = true) } catch (e: CancellationException) { throw e } catch (e: Exception) { raceFailed = true }
        }
    }

    /** Plays extra set [n]: the duels of the set it still lacks (a set left half-way continues). */
    fun startSet(n: Int) {
        if (loading || n !in Rules.EXTRA_SETS || !setOpen(n)) return
        val entry = sets.first { it.n == n }
        if (entry.done) return
        scope.launch {
            loading = true; error = null
            try {
                val duels = api.dealSet(n, localDay(), seasonOf()).filter { "${it.pair}|${it.dim}" !in seen }.take(Rules.SET_SIZE - entry.votes)
                if (duels.isEmpty()) { game.end(); return@launch }
                game.start(Mode.Daily, duels, set = n)
                scope.launch { game.loadTallies() }
                duels.take(2).forEach { ensureImages(it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                error = "${text("app.dealFailed")} (${e.status}: ${e.message})"
            } catch (e: Exception) {
                error = "${text("app.noNetwork")} (${e::class.simpleName}: ${e.message?.take(100)})"
            } finally {
                loading = false
            }
        }
    }

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
                error = "${text("app.dealFailed")} (${e.status}: ${e.message})"
            } catch (e: Exception) {
                // the kind of failure is shown so that "no connection" can be told apart from a blocked or slow server
                error = "${text("app.noNetwork")} (${e::class.simpleName}: ${e.message?.take(100)})"
            } finally {
                loading = false
            }
        }
    }

    private val AVATAR_BUCKET = "avatars"

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
                } catch (e: LinkageError) {
                    imageFailed[k] = true // the picture decoder (Skia) could not start: show the placeholder instead of crashing
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
            catch (e: CancellationException) { throw e } catch (e: Exception) { imageFailed[url] = true } catch (e: LinkageError) { imageFailed[url] = true }
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
        runCatching { api.state(localDay()) }.getOrNull()?.let { adopt(it) }
    }

    private var flushJob: Job? = null
    private fun scheduleFlush() {
        flushJob?.cancel()
        flushJob = scope.launch { delay(3500); offline = !game.flush() }
    }

    // ---- Taste DNA -----------------------------------------------------------------------------------------------------------------

    /** how my picks lean along the seven taste axes (null until computed) */
    var dna by mutableStateOf<Taste.Result?>(null)
        private set
    var dnaLoading by mutableStateOf(false)
        private set
    var dnaFailed by mutableStateOf(false)
        private set
    private var dnaForVotes = -1L
    private val traitCache = HashMap<String, DoubleArray>()
    private val pairRe = Regex("^(\\d{6})/([a-z]{2,12})/(\\d{1,4})-(\\d{1,4})$")

    /** Reads this and last season's answers and the traits of the specimens (from the same generator as the website), and computes the DNA. Cheap to call again: it only works when the vote count changed. */
    fun loadDna() {
        val total = (profile?.votes ?: 0).toLong()
        if (dnaLoading || (dna != null && dnaForVotes == total)) return
        scope.launch {
            dnaLoading = true; dnaFailed = false
            try {
                val season = seasonOf()
                val rows = listOf(prevSeason(season), season).flatMap { api.myVoteRows(it) }
                val answers = rows.mapNotNull { (pair, dim, pick) -> pairRe.matchEntire(pair)?.let { Triple(it.groupValues, dim, pick) } }
                val need = answers.flatMap { (g, _, _) -> listOf(Triple(g[1], g[2], g[3].toInt()), Triple(g[1], g[2], g[4].toInt())) }
                    .filter { "${it.first}/${it.second}/${it.third}" !in traitCache }.distinct()
                for (chunk in need.chunked(2500)) for ((k, v) in api.traits(chunk)) traitCache[k] = v
                val zero = DoubleArray(Taste.TRAITS.size)
                dna = Taste.build(answers.map { (g, dim, pick) ->
                    Taste.Answer(dim, pick, traitCache["${g[1]}/${g[2]}/${g[3].toInt()}"] ?: zero, traitCache["${g[1]}/${g[2]}/${g[4].toInt()}"] ?: zero)
                })
                dnaForVotes = total
            } catch (e: CancellationException) { throw e } catch (e: Exception) { dnaFailed = true } finally { dnaLoading = false }
        }
    }

    // ---- my profile ------------------------------------------------------------------------------------------------------------------

    fun loadMyProfile() {
        val uid = api.session?.userId ?: return
        scope.launch {
            try {
                myProfile = api.restGet("profiles", kotlinx.serialization.builtins.ListSerializer(MyProfileRow.serializer()), "select" to "full_name,username,role_title,bio,avatar_url", "id" to "eq.$uid").firstOrNull()
            } catch (e: CancellationException) { throw e } catch (e: Exception) { /* the form just stays empty */ }
        }
    }

    var avatarBusy by mutableStateOf(false)
        private set

    /** Chooses a picture, shrinks it, uploads it to the avatars bucket (the player's own folder) and points the profile at it; the previous file is removed. Returns the locale key to show (success or why not), or null if cancelled. */
    suspend fun changeAvatar(): String? {
        val uid = api.session?.userId ?: return null
        val (img, why) = space.affinix.app.ImageRules.chooseAndShrink(space.affinix.app.ImageRules.AVATAR_SIDE, space.affinix.app.ImageRules.AVATAR_BYTES)
        if (img == null) return why
        avatarBusy = true
        return try {
            val path = "$uid/${Platform.uuid()}.${img.ext}"
            api.uploadObject(AVATAR_BUCKET, path, img.bytes, img.mime)
            val url = api.publicObjectUrl(AVATAR_BUCKET, path)
            val previous = myProfile?.avatarUrl
            api.restWrite(io.ktor.http.HttpMethod.Patch, "profiles", listOf("id" to "eq.$uid"), kotlinx.serialization.json.buildJsonObject { put("avatar_url", url) })
            myProfile = (myProfile ?: MyProfileRow()).copy(avatarUrl = url)
            api.pathFromPublicUrl(AVATAR_BUCKET, previous)?.takeIf { it.startsWith("$uid/") }?.let { old -> runCatching { api.removeObjects(AVATAR_BUCKET, listOf(old)) } }
            "app.photoSaved"
        } catch (e: CancellationException) { throw e } catch (e: Exception) { "app.imageFailed" } finally { avatarBusy = false }
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
            myProfile = MyProfileRow(name.trim(), u.ifEmpty { null }, role.trim(), bio.trim(), myProfile?.avatarUrl)
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
