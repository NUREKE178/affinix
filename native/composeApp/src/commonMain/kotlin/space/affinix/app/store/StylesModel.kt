package space.affinix.app.store

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import space.affinix.app.Rules
import space.affinix.app.localDay
import space.affinix.app.net.Api
import space.affinix.app.net.ApiException
import space.affinix.app.net.ApiJson
import space.affinix.app.seasonOf

/**
 * "What people love" (the website's Styles page): which STYLE wins when the Arena crowd is asked "which looks more premium / friendlier / more natural ...".
 * Two database functions give the counts (arena_style_report for everyone, arena_style_segments for countries with enough players); the measured traits of the specimens
 * come from the website's own generator through /api/arena-traits; [StyleStats] puts them together. The same filters as the site: question, kind of design,
 * which designs (all / today's drop / classics), month and audience.
 */
class StylesModel(private val api: Api, private val scope: CoroutineScope) {
    enum class Status { Idle, Loading, Ready, Error }

    class Country(val code: String, val voters: Int, val votes: Int)

    class Data(val votes: Int, val voters: Int, val entries: List<StyleStats.Entry>, val countries: List<Country>, val byCountry: Map<String, List<StyleStats.Entry>>)

    /** what the screen shows for the chosen filters */
    class View(
        val overall: List<StyleStats.Lift>, val lifts: List<StyleStats.Lift>, val ranked: StyleStats.Ranked, val recipe: List<StyleStats.Lift>,
        val duels: Int, val specimens: Int, val picked: Boolean, val enough: Boolean, val reliability: String,
    )

    var status by mutableStateOf(Status.Idle)
        private set
    /** "updatePending" (migration 0026 missing), "offline" or "generic" */
    var error by mutableStateOf<String?>(null)
        private set
    var data by mutableStateOf<Data?>(null)
        private set

    var dim by mutableStateOf("preference")
        private set
    var family by mutableStateOf("all")
        private set
    /** which designs: all | today (today's drop) | classic */
    var scopeKind by mutableStateOf("all")
        private set
    var lastMonth by mutableStateOf(false)
        private set
    var country by mutableStateOf("all")
        private set

    val season: String get() = if (lastMonth) previousSeason(seasonOf()) else seasonOf()

    private var job: Job? = null
    private val memo = HashMap<String, Data>()

    fun pickDim(id: String) { if (id == dim) return; dim = id; country = "all"; load() }
    fun pickFamily(id: String) { if (id == family) return; family = id; country = "all"; load() }
    fun pickSeason(last: Boolean) { if (last == lastMonth) return; lastMonth = last; country = "all"; load() }
    fun pickScope(kind: String) { scopeKind = kind }
    fun pickCountry(code: String) { country = code }

    fun load(force: Boolean = false) {
        val season = season; val d = dim; val f = family
        val key = "$season|$d|$f"
        if (!force) memo[key]?.let { data = it; status = Status.Ready; error = null; return }
        job?.cancel()
        status = Status.Loading; error = null; data = null
        job = scope.launch {
            try {
                val res = fetch(season, d, if (f == "all") null else f)
                memo[key] = res
                data = res; status = Status.Ready
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = codeOf(e); status = Status.Error
            }
        }
    }

    private fun codeOf(e: Exception): String =
        if (e is ApiException && (e.status == 404 || e.message.orEmpty().contains("Could not find the function", true) || e.message.orEmpty().contains("PGRST202"))) "updatePending"
        else if (e is ApiException) "generic" else "offline"

    private class Row(val country: String?, val stim: String, val wins: Int, val losses: Int)

    private fun num(e: JsonElement?): Int = (e as? JsonPrimitive)?.let { p -> p.content.toDoubleOrNull()?.toLong()?.toInt() } ?: 0

    private suspend fun fetch(season: String, dim: String, family: String?): Data {
        val rep = ApiJson.parseToJsonElement(api.rpcText("arena_style_report", buildJsonObject { put("p_season", season); put("p_dim", dim); put("p_family", family); put("p_min", 4) })).jsonObject
        val rows = rep["rows"]?.jsonArray.orEmpty().map { r -> val a = r.jsonArray; Row(null, a[0].jsonPrimitive.content, num(a[2]), num(a[3])) }
        val countries = ArrayList<Country>(); val segRows = ArrayList<Row>()
        try {
            // the audience is a bonus: a server without it still gives the overall picture
            val seg = ApiJson.parseToJsonElement(api.rpcText("arena_style_segments", buildJsonObject { put("p_season", season); put("p_dim", dim); put("p_family", family); put("p_min_voters", 8) })).jsonObject
            seg["countries"]?.jsonArray.orEmpty().forEach { c -> val o = c.jsonObject; countries += Country(o["code"]!!.jsonPrimitive.content, num(o["voters"]), num(o["votes"])) }
            if (countries.isNotEmpty()) seg["rows"]?.jsonArray.orEmpty().forEach { r -> val a = r.jsonArray; segRows += Row(a[0].jsonPrimitive.content, a[1].jsonPrimitive.content, num(a[2]), num(a[3])) }
        } catch (e: CancellationException) { throw e } catch (e: Exception) { countries.clear(); segRows.clear() }

        val keepAll = keep(rows); val keepSeg = keep(segRows)
        val wanted = LinkedHashSet<Triple<String, String, Int>>()
        for (r in rows + segRows) {
            if (r.stim !in keepAll && r.stim !in keepSeg) continue
            val (fam, idx) = StyleStats.parseKey(r.stim) ?: continue
            if (fam in Rules.FAMILY_IDS) wanted += Triple(season, fam, idx)
        }
        val traits = HashMap<String, DoubleArray>()
        wanted.toList().chunked(3000).forEach { traits += api.traits(it) }

        fun entries(list: List<Row>, keep: Set<String>) = list.mapNotNull { r ->
            if (r.stim !in keep) return@mapNotNull null
            val (fam, idx) = StyleStats.parseKey(r.stim) ?: return@mapNotNull null
            if (fam !in Rules.FAMILY_IDS) return@mapNotNull null
            val tr = traits["$season/$fam/$idx"] ?: return@mapNotNull null
            StyleStats.Entry(r.stim, fam, idx, r.wins, r.losses, tr, r.country)
        }
        val byCountry = LinkedHashMap<String, MutableList<StyleStats.Entry>>()
        for (e in entries(segRows, keepSeg)) byCountry.getOrPut(e.country!!) { ArrayList() }.add(e)
        return Data(num(rep["votes"]), num(rep["voters"]), entries(rows, keepAll), countries, byCountry)
    }

    /** the most answered specimens, at most [StyleStats.MAX_SPECIMENS] (the site's `withTraits` keeps the same ones) */
    private fun keep(rows: List<Row>): Set<String> {
        val best = LinkedHashMap<String, Int>()
        for (r in rows) best[r.stim] = (best[r.stim] ?: 0) + r.wins + r.losses
        return best.entries.sortedByDescending { it.value }.take(StyleStats.MAX_SPECIMENS).map { it.key }.toSet()
    }

    /** the numbers for the chosen filters; null until loaded */
    fun view(): View? {
        val d = data ?: return null
        val overall = StyleStats.traitLifts(d.entries)
        val picked = if (country != "all") d.byCountry[country] else null
        val todayPool = dropPoolForDay(localDay())
        val base = (picked ?: d.entries).filter { e ->
            val pool = e.index / POOL_SIZE
            scopeKind == "all" || (if (scopeKind == "today") pool == todayPool else pool == CLASSIC_POOL)
        }
        val lifts = StyleStats.traitLifts(base)
        val ranked = StyleStats.rankSpecimens(base, top = 12, bottom = 4, minAnswers = if (scopeKind == "today") 3 else 6)
        val duels = base.sumOf { it.wins }
        val reliability = if (duels >= 600) "high" else if (duels >= 150) "mid" else "low"
        return View(
            if (picked != null) overall else lifts, lifts, ranked, StyleStats.recipeOf(lifts), duels, base.map { it.stim }.toSet().size, picked != null,
            duels >= (if (scopeKind == "today") 20 else 60), reliability,
        )
    }

    companion object {
        const val POOL_SIZE = 32
        const val CLASSIC_POOL = 0
        /** the drop pool of a local day "YYYY-MM-DD": its day of the month (1..31), as catalog.js */
        fun dropPoolForDay(day: String): Int = day.substring(8, 10).toIntOrNull()?.takeIf { it in 1..31 } ?: 1
        /** "202611" -> "202610", "202601" -> "202512" */
        fun previousSeason(s: String): String {
            var y = s.substring(0, 4).toInt(); var m = s.substring(4).toInt() - 1
            if (m == 0) { m = 12; y -= 1 }
            return "$y${m.toString().padStart(2, '0')}"
        }
    }
}
