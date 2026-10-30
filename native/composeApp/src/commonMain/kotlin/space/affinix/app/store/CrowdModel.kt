package space.affinix.app.store

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import space.affinix.app.Platform
import space.affinix.app.ShrunkImage
import space.affinix.app.net.Api
import space.affinix.app.net.ApiException
import space.affinix.app.net.ApiJson
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

@Serializable
data class CrowdItem(val id: String, val pos: Int = 0, val label: String? = null, val path: String? = null, val wins: Int = 0, val games: Int = 0)

@Serializable
data class CrowdTest(
    val id: String, val title: String = "", val dim: String = "preference", val status: String = "open",
    val target: Int = 0, val votes: Int = 0, val voters: Int = 0, val createdAt: String = "", val note: String? = null,
    val items: List<CrowdItem> = emptyList(),
)

@Serializable
data class CrowdPair(val a: String, val b: String, val aVotes: Int = 0, val bVotes: Int = 0)

@Serializable
data class CrowdResult(val test: CrowdTest, val pairs: List<CrowdPair> = emptyList(), val avgMs: Double? = null)

/** an option being typed into the form: a caption and/or a picture */
class DraftOption(val label: String, val image: ShrunkImage?)

/** The verdict of a test, the same rule as src/lib/crowdStore.js: every option's win rate with a 95% Wilson interval; below 30 duels no verdict. */
object CrowdVerdict {
    const val MIN_RELIABLE = 30

    fun wilson(successes: Int, n: Int, z: Double = 1.96): Pair<Double, Double> {
        if (n == 0) return 0.0 to 0.0
        val p = successes.toDouble() / n
        val denom = 1 + z * z / n
        val center = p + z * z / (2 * n)
        val margin = z * sqrt(p * (1 - p) / n + z * z / (4.0 * n * n))
        return max(0.0, (center - margin) / denom) to min(1.0, (center + margin) / denom)
    }

    class Row(val item: CrowdItem, val rate: Double?, val lo: Double, val hi: Double)

    /** [state]: empty (nobody answered), collecting (the leader has fewer than 30 duels), winner (the leader's interval lies wholly above the runner-up's), close */
    class Verdict(val ranked: List<Row>, val state: String, val progress: Float) { val lead: Row? get() = ranked.firstOrNull() }

    fun of(t: CrowdTest): Verdict {
        val rows = t.items.map { i ->
            val r = if (i.games > 0) i.wins.toDouble() / i.games else null
            val (lo, hi) = if (i.games > 0) wilson(i.wins, i.games) else 0.0 to 0.0
            Row(i, r, lo, hi)
        }
        val ranked = rows.sortedWith(compareByDescending<Row> { it.rate ?: -1.0 }.thenBy { it.item.pos })
        val lead = ranked.firstOrNull(); val next = ranked.getOrNull(1)
        var state = "empty"
        if (t.votes > 0) state = when {
            lead == null || lead.item.games < MIN_RELIABLE -> "collecting"
            next != null && next.item.games > 0 && lead.lo > next.hi -> "winner"
            else -> "close"
        }
        return Verdict(ranked, state, if (t.target > 0) min(1f, t.votes.toFloat() / t.target) else 0f)
    }
}

/**
 * Crowd tests, the owner's side (migration 0022): put 2-4 options in front of the Arena crowd, read the verdict. The players' side (answering other people's
 * tests as missions of the Daily Challenge) is not in the app yet.
 */
class CrowdModel(private val api: Api, private val scope: CoroutineScope, private val me: () -> String?, private val xp: () -> Long) {
    var tests by mutableStateOf<List<CrowdTest>>(emptyList())
        private set
    var loaded by mutableStateOf(false)
        private set
    /** the locale key of why the list could not be read (null = fine) */
    var loadError by mutableStateOf<String?>(null)
        private set
    var view by mutableStateOf(View.List)
    var openId by mutableStateOf<String?>(null)
    var result by mutableStateOf<CrowdResult?>(null)
        private set
    var resultError by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    enum class View { List, Create, Detail }

    /** the level that opens test creation (100 XP): play before you ask */
    val locked: Boolean get() = xp() < CREATE_MIN_XP
    val openCount: Int get() = tests.count { it.status == "open" }

    fun errorKey(e: Exception): String {
        if (e is ApiException) {
            val h = e.hint
            if (h != null) return "crowd.err.$h"
            if (e.status == 404 || e.message.contains("Could not find the function")) return "crowd.err.pending"
            return "crowd.err.generic"
        }
        return "crowd.err.offline"
    }

    fun load() { scope.launch { loadNow() } }

    internal suspend fun loadNow() {
        try {
            tests = api.rpc("arena_test_mine", buildJsonObject {}, ListSerializer(CrowdTest.serializer()))
            loaded = true; loadError = null
        } catch (e: CancellationException) { throw e } catch (e: Exception) { loadError = errorKey(e); loaded = true }
    }

    fun open(id: String) { openId = id; result = null; resultError = null; view = View.Detail; loadResult() }
    fun back() { view = View.List; openId = null; result = null; load() }

    fun loadResult() {
        val id = openId ?: return
        scope.launch {
            try { result = api.rpc("arena_test_results", buildJsonObject { put("p_test", id) }, CrowdResult.serializer()); resultError = null }
            catch (e: CancellationException) { throw e } catch (e: Exception) { if (result == null) resultError = errorKey(e) }
        }
    }

    /** Checks the form the way the database will, so a problem is heard before an upload: the locale key, or null when fine. */
    fun validate(title: String, dim: String, options: List<DraftOption>): String? {
        val t = title.trim()
        if (t.length < MIN_TITLE || t.length > MAX_TITLE) return "crowd.err.bad_title"
        if (dim !in DIMS) return "crowd.err.bad_question"
        val filled = options.filter { it.label.isNotBlank() || it.image != null }
        if (filled.size !in MIN_OPTIONS..MAX_OPTIONS || filled.any { it.label.trim().length > MAX_LABEL }) return "crowd.err.bad_items"
        return null
    }

    /** Uploads the pictures, then creates the test; when the database refuses, the uploaded files are removed again. Returns null when created, else the locale key. */
    suspend fun create(title: String, dim: String, options: List<DraftOption>): String? {
        validate(title, dim, options)?.let { return it }
        val uid = me() ?: return "crowd.err.signed_out"
        busy = true
        val uploaded = ArrayList<String>()
        return try {
            val items = ArrayList<kotlinx.serialization.json.JsonObject>()
            for (o in options.filter { it.label.isNotBlank() || it.image != null }) {
                var path: String? = null
                if (o.image != null) {
                    path = "$uid/${Platform.uuid()}.${o.image.ext}"
                    api.uploadObject(BUCKET, path, o.image.bytes, o.image.mime)
                    uploaded += path
                }
                items += buildJsonObject { if (o.label.isNotBlank()) put("label", o.label.trim()); if (path != null) put("path", path) }
            }
            api.rpcText("arena_test_create", buildJsonObject { put("p_title", title.trim()); put("p_dim", dim); put("p_items", JsonArray(items)) })
            loadNow()
            null
        } catch (e: CancellationException) { throw e } catch (e: Exception) {
            if (uploaded.isNotEmpty()) runCatching { api.removeObjects(BUCKET, uploaded) }
            errorKey(e)
        } finally { busy = false }
    }

    /** Pause or reopen; returns null when done, else the locale key. */
    suspend fun setStatus(t: CrowdTest, open: Boolean): String? {
        busy = true
        return try {
            api.rpcText("arena_test_set_status", buildJsonObject { put("p_test", t.id); put("p_status", if (open) "open" else "closed") })
            loadResult(); loadNow(); null
        } catch (e: CancellationException) { throw e } catch (e: Exception) { errorKey(e) } finally { busy = false }
    }

    /** Deletes the test and the pictures of its options. */
    suspend fun delete(t: CrowdTest): String? {
        busy = true
        return try {
            val out = api.rpcText("arena_test_delete", buildJsonObject { put("p_test", t.id) })
            val paths = runCatching { ApiJson.parseToJsonElement(out).jsonObject["paths"]!!.jsonArray.map { it.jsonPrimitive.content } }.getOrDefault(emptyList())
            if (paths.isNotEmpty()) runCatching { api.removeObjects(BUCKET, paths) }
            back(); null
        } catch (e: CancellationException) { throw e } catch (e: Exception) { errorKey(e) } finally { busy = false }
    }

    fun imageUrl(path: String?): String? = path?.let { api.publicObjectUrl(BUCKET, it) }

    companion object {
        const val BUCKET = "arena-tests"
        const val CREATE_MIN_XP = 100L
        const val MIN_OPTIONS = 2
        const val MAX_OPTIONS = 4
        const val MIN_TITLE = 3
        const val MAX_TITLE = 80
        const val MAX_LABEL = 60
        const val MAX_SIDE = 1024
        const val MAX_BYTES = 900 * 1024
        val DIMS = listOf("preference", "attention", "trust", "quality", "premium", "clarity", "purchaseIntent")
    }
}
