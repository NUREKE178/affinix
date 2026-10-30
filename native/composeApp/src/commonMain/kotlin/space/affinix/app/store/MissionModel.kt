package space.affinix.app.store

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import space.affinix.app.Platform
import space.affinix.app.Prng
import space.affinix.app.localDay
import space.affinix.app.net.Api
import space.affinix.app.net.ApiException
import space.affinix.app.net.StateResponse

@Serializable
data class MissionOwner(val id: String = "", val name: String? = null, val username: String? = null, val avatarUrl: String? = null)

@Serializable
data class MissionTest(
    val id: String, val title: String = "", val dim: String = "preference", val owner: MissionOwner? = null,
    val items: List<CrowdItem> = emptyList(), val pairs: List<List<String>> = emptyList(), val done: Int = 0, val total: Int = 0,
)

@Serializable
data class MissionQueue(val available: Int = 0, val missionXp: Int = 0, val cap: Int = 300, val tests: List<MissionTest> = emptyList())

@Serializable
data class VoteOut(val accepted: Boolean = false, val xp: Int = 0, val bonus: Int = 0, val capped: Boolean = false, val reason: String? = null, val aVotes: Int? = null, val bVotes: Int? = null)

@Serializable
data class MissionVoteResponse(val results: List<VoteOut> = emptyList(), val missionXp: Int? = null, val status: String? = null, val state: StateResponse? = null)

/** one pair of options to judge; [swap] puts option b on the left */
data class MissionDuel(val a: String, val b: String, val swap: Boolean)

data class MissionResult(
    val duel: MissionDuel, val pick: String, val side: Int, val ms: Long,
    val pending: Boolean = true, val error: String? = null, val xp: Int = 0, val bonus: Int = 0, val capped: Boolean = false,
    /** votes for duel.a and duel.b (null until the server answered) */
    val tally: Pair<Int, Int>? = null,
)

data class MissionRound(
    val test: MissionTest, val duels: List<MissionDuel>, val idx: Int = 0, val phase: Phase = Phase.Choose,
    val results: List<MissionResult> = emptyList(), val shownAt: Long = 0, val missionXp: Int? = null, val testStatus: String? = null,
) {
    val duel: MissionDuel? get() = duels.getOrNull(idx)
    val last: MissionResult? get() = results.lastOrNull()
    val xp: Int get() = results.sumOf { it.xp + it.bonus }
}

/**
 * Research missions (the players' side of crowd tests, migration 0022): other people's tests are offered once the day's ten duels are done, each pair of options
 * is a duel, every answer goes to the server at once (it pays the XP and returns the split of the crowd). Port of startMission / voteMission in src/lib/arenaStore.js.
 */
class MissionModel(private val api: Api, private val scope: CoroutineScope, private val me: () -> String?, private val onState: (StateResponse) -> Unit) {
    var queue by mutableStateOf<MissionQueue?>(null)
        private set
    var queueError by mutableStateOf<String?>(null)
        private set
    var round by mutableStateOf<MissionRound?>(null)
        private set
    var reported by mutableStateOf(false)
        private set

    private fun errorKey(e: Exception): String = when {
        e is ApiException && (e.status == 404 || e.message.contains("Could not find the function")) -> "pending"
        e is ApiException && e.hint != null -> e.hint
        e is ApiException -> "generic"
        else -> "offline"
    }

    fun loadQueue() {
        scope.launch {
            try { queue = api.rpc("arena_test_queue", buildJsonObject { put("p_limit", 3) }, MissionQueue.serializer()); queueError = null }
            catch (e: CancellationException) { throw e } catch (e: Exception) { queueError = errorKey(e) }
        }
    }

    /** The pairs this player still owes, in random order and with random sides. */
    fun start(test: MissionTest) {
        if (test.pairs.isEmpty()) return
        val rand = Prng.mulberry32(Prng.hashStringToSeed("${me()}/${test.id}/${Platform.nowMillis()}/${Platform.uuid()}"))
        val order = test.pairs.indices.map { it to rand() }.sortedBy { it.second }
        val duels = order.map { (i, _) -> MissionDuel(test.pairs[i][0], test.pairs[i][1], rand() < 0.5) }
        reported = false
        round = MissionRound(test, duels, shownAt = Platform.nowMillis(), missionXp = queue?.missionXp)
    }

    /** [side]: 0 = the option on the left. */
    fun vote(side: Int) {
        val r = round ?: return
        if (r.phase != Phase.Choose) return
        val d = r.duel ?: return
        val left = if (d.swap) d.b else d.a; val right = if (d.swap) d.a else d.b
        val pick = if (side == 0) left else right
        val result = MissionResult(d, pick, side, (Platform.nowMillis() - r.shownAt).coerceAtLeast(0))
        round = r.copy(phase = Phase.Reveal, results = r.results + result)
        send(result)
    }

    fun retry() { val l = round?.last ?: return; if (l.error != null) send(l) }

    private fun send(result: MissionResult) {
        val test = round?.test ?: return
        patch(result) { it.copy(pending = true, error = null) }
        scope.launch {
            try {
                val res = api.rpc(
                    "arena_test_vote",
                    buildJsonObject {
                        put("p_test", test.id)
                        put("p_votes", JsonArray(listOf(buildJsonObject { put("a", result.duel.a); put("b", result.duel.b); put("pick", result.pick); put("ms", result.ms) })))
                        put("p_day", localDay())
                    },
                    MissionVoteResponse.serializer(),
                )
                val out = res.results.firstOrNull() ?: VoteOut()
                // the server counts votes for the lower item id and the higher one; the screen needs them per option
                val aIsLow = result.duel.a < result.duel.b
                val tally = if (out.aVotes == null || out.bVotes == null) null else if (aIsLow) out.aVotes to out.bVotes else out.bVotes to out.aVotes
                patch(result) { it.copy(pending = false, xp = out.xp, bonus = out.bonus, capped = out.capped, tally = tally) }
                round = round?.copy(missionXp = res.missionXp ?: round?.missionXp, testStatus = res.status ?: round?.testStatus)
                res.state?.let(onState)
            } catch (e: CancellationException) { throw e } catch (e: Exception) { patch(result) { it.copy(pending = false, error = errorKey(e)) } }
        }
    }

    private fun patch(old: MissionResult, f: (MissionResult) -> MissionResult) {
        val r = round ?: return
        round = r.copy(results = r.results.map { if (it.duel == old.duel && it.pick == old.pick && it.ms == old.ms) f(it) else it })
    }

    /** on to the next pair; a test that closed in the meantime ends the mission, an answer that was not sent has to be sent again first */
    fun next() {
        val r = round ?: return
        if (r.phase != Phase.Reveal) return
        val last = r.last
        if (last?.pending == true) return
        val err = last?.error
        if (err != null) { if (err in TERMINAL) round = r.copy(phase = Phase.Summary); return }
        val closed = r.testStatus != null && r.testStatus != "open"
        round = if (closed || r.idx + 1 >= r.duels.size) r.copy(phase = Phase.Summary) else r.copy(idx = r.idx + 1, phase = Phase.Choose, shownAt = Platform.nowMillis())
    }

    fun end() { round = null; loadQueue() }

    /** Hide this test for me and tell the moderators. */
    fun report(test: MissionTest) {
        scope.launch {
            try { api.rpcText("arena_test_report", buildJsonObject { put("p_test", test.id); put("p_reason", JsonPrimitive(null as String?)) }); reported = true }
            catch (e: CancellationException) { throw e } catch (e: Exception) { /* nothing to show: the button stays */ }
        }
    }

    fun imageUrl(path: String?): String? = path?.let { api.publicObjectUrl(CrowdModel.BUCKET, it) }

    companion object {
        /** answers that end a mission instead of offering a retry (see arena_test_vote) */
        val TERMINAL = setOf("closed", "own", "pending")
    }
}
