package space.affinix.app.store

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import space.affinix.app.Platform
import space.affinix.app.net.Api
import space.affinix.app.net.Person

/** What the caller already knows about a person's place in the Arena (a rankings row): shown as a strip in the profile. [allTime] says which XP it is. */
data class ArenaInfo(val rank: Int?, val level: Int, val xp: Long, val streak: Int = 0, val allTime: Boolean = false)

/**
 * The one profile card of the whole app, like the website's ProfileViewerHost: anything that shows a person (an avatar, a name) calls [open]; the card shows what the caller
 * already has at once, then the authoritative row from profiles_public (a bio, a role, a @username) and the friend count (friends_count, a SECURITY DEFINER RPC, so it works
 * for anyone) when they arrive. Seen people are remembered for a minute so that a second opening has no gap.
 */
class ProfileViewerModel(private val api: Api, private val scope: CoroutineScope, private val me: () -> String?, private val feed: FeedModel) {
    var person by mutableStateOf<Person?>(null)
        private set
    var arena by mutableStateOf<ArenaInfo?>(null)
        private set
    /** true once the lookup of the full row has settled, either way */
    var detailsDone by mutableStateOf(false)
        private set
    /** null until known (or when the count cannot be read: then it is simply not shown) */
    var friendsCount by mutableStateOf<Int?>(null)
        private set

    val isOpen: Boolean get() = person != null
    val isSelf: Boolean get() = person?.id.let { !it.isNullOrEmpty() && it == me() }

    private var job: Job? = null
    private val cache = HashMap<String, Pair<Long, Person>>()

    /** Shows [who]; a person without an id (nothing to look up) is shown as given. */
    fun open(who: Person, arena: ArenaInfo? = null) {
        if (who.id.isBlank() && who.name.isNullOrBlank()) return
        job?.cancel()
        this.arena = arena
        friendsCount = null
        val known = cached(who.id)
        person = if (known != null) merge(who, known) else who
        detailsDone = who.id.isBlank() || known != null
        if (who.id.isBlank()) return
        job = scope.launch { load(who, needDetails = known == null) }
    }

    fun close() {
        job?.cancel()
        person = null; arena = null; friendsCount = null; detailsDone = false
    }

    private fun cached(id: String): Person? = cache[id]?.takeIf { Platform.nowMillis() - it.first < TTL_MS }?.second

    /** what the lookup knows wins, except that a missing value never erases what the caller had */
    private fun merge(base: Person, got: Person) = base.copy(
        name = got.name ?: base.name, username = got.username ?: base.username, avatarUrl = got.avatarUrl ?: base.avatarUrl,
        roleTitle = got.roleTitle ?: base.roleTitle, bio = got.bio ?: base.bio,
    )

    private suspend fun load(base: Person, needDetails: Boolean) {
        try {
            coroutineScope {
                if (needDetails) launch {
                    try {
                        val got = feed.authors(listOf(base.id))[base.id]
                        if (got != null) cache[base.id] = Platform.nowMillis() to got
                        if (person?.id == base.id) { if (got != null) person = merge(base, got); detailsDone = true }
                    } catch (e: CancellationException) { throw e } catch (e: Exception) { if (person?.id == base.id) detailsDone = true }
                }
                launch {
                    try {
                        val n = api.rpcText("friends_count", buildJsonObject { put("target_id", base.id) }).trim().trim('"').toIntOrNull()
                        if (person?.id == base.id) friendsCount = n
                    } catch (e: CancellationException) { throw e } catch (e: Exception) { /* a count that cannot be read is just not shown */ }
                }
            }
        } catch (e: CancellationException) { throw e }
    }

    companion object { const val TTL_MS = 60_000L }
}
