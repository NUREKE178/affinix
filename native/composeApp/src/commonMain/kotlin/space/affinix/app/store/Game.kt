package space.affinix.app.store

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import space.affinix.app.Platform
import space.affinix.app.Rules
import space.affinix.app.net.Duel
import space.affinix.app.net.Tally
import space.affinix.app.net.TallyQuery
import space.affinix.app.net.WireVote

enum class Phase { Choose, Reveal, Summary }

enum class Mode { Daily, Free }

/** What one answered duel looked like, for the reveal and the summary. */
data class Result(
    val duel: Duel,
    /** canonical side (0 = a, 1 = b) */
    val pick: Int,
    /** side on screen (0 = left, 1 = right) */
    val side: Int,
    val xp: Int,
    val bonus: Int,
    val combo: Int,
    val eye: Boolean?,
    val crowd: Boolean?,
    val pioneer: Boolean,
    val ms: Long,
    val tally: Tally?,
)

data class Round(
    val mode: Mode,
    val day: String,
    val duels: List<Duel>,
    val idx: Int = 0,
    val phase: Phase = Phase.Choose,
    val results: List<Result> = emptyList(),
    val skipped: Int = 0,
    val combo: Int = 0,
    val shownAt: Long = 0,
    val tallies: Map<String, Tally> = emptyMap(),
    val last: Result? = null,
) {
    val duel: Duel? get() = duels.getOrNull(idx)
    val xp: Int get() = results.sumOf { it.xp }
    val bestCombo: Int get() = results.maxOfOrNull { it.combo } ?: 0
}

private fun key(d: Duel) = "${d.pair}|${d.dim}"

/**
 * The state machine of one Arena round, a port of the vote/next/advance logic in src/lib/arenaStore.js (the part that does not
 * touch the browser). It is pure: time comes from [now], network from the [Sink], so it is unit-testable without a UI.
 */
class Game(
    private val sink: Sink,
    private val now: () -> Long = Platform::nowMillis,
    private val newId: () -> String = Platform::uuid,
    private val today: () -> String = { space.affinix.app.localDay() },
) {
    interface Sink {
        suspend fun tallies(items: List<TallyQuery>): List<Tally>
        suspend fun submit(votes: List<WireVote>, day: String)
    }

    private val _round = MutableStateFlow<Round?>(null)
    val round: StateFlow<Round?> = _round

    /** Votes not yet accepted by the server, oldest first. They survive failed flushes. */
    private val pending = ArrayDeque<WireVote>()
    private val flushLock = Mutex()
    val pendingCount get() = pending.size

    fun start(mode: Mode, duels: List<Duel>) {
        _round.value = if (duels.isEmpty()) null else Round(mode, today(), duels, shownAt = now())
    }

    /** Fetches the crowd's counts for the whole round once, so the reveal can show them at once. */
    suspend fun loadTallies() {
        val r = _round.value ?: return
        val items = r.duels.filter { !it.repeat }.map { TallyQuery(it.pair, it.dim) }
        if (items.isEmpty()) return
        val got = runCatching { sink.tallies(items) }.getOrNull() ?: return
        val map = got.associateBy { "${it.pair}|${it.dim}" }
        _round.update { cur -> cur?.copy(tallies = cur.tallies + map) }
    }

    /** [side]: 0 = the left specimen on screen, 1 = the right one. */
    fun vote(side: Int) {
        val r = _round.value ?: return
        if (r.phase != Phase.Choose) return
        val duel = r.duel ?: return
        val pick = if (duel.swap) 1 - side else side
        val ms = (now() - r.shownAt).coerceAtLeast(0)
        val tally = r.tallies[key(duel)]
        val total = tally?.total
        val pioneer = total == 0
        val crowd = if (tally != null && total!! >= Rules.CROWD_MIN_VOTES && tally.a != tally.b) pick == (if (tally.a > tally.b) 0 else 1) else null
        val combo = if (duel.repeat) r.combo else if (Rules.isFlowMs(ms)) r.combo + 1 else 0
        val bonus = Rules.flowBonus(combo)
        val eye = if (duel.objective) pick == duel.truth else null
        val xp = if (duel.repeat) 0 else Rules.voteXp(ms, bonus, pioneer)
        if (!duel.repeat) {
            pending.addLast(
                WireVote(newId(), duel.pair, duel.dim, pick, ms, bonus, r.day, duel.daily, duel.set.takeIf { it > 0 }, eye, combo),
            )
        }
        val result = Result(duel, pick, side, xp, bonus, combo, eye, crowd, pioneer, ms, tally)
        _round.value = r.copy(phase = Phase.Reveal, combo = combo, results = r.results + result, last = result)
    }

    fun skip() {
        val r = _round.value ?: return
        if (r.phase != Phase.Choose) return
        advance(r.copy(combo = 0, skipped = r.skipped + 1))
    }

    fun next() {
        val r = _round.value ?: return
        if (r.phase != Phase.Reveal) return
        advance(r)
    }

    private fun advance(r: Round) {
        _round.value = if (r.idx + 1 >= r.duels.size) r.copy(phase = Phase.Summary) else r.copy(idx = r.idx + 1, phase = Phase.Choose, shownAt = now())
    }

    fun end() { _round.value = null }

    /** Sends pending votes in batches; returns true when the queue is empty. A failure keeps what was not accepted. */
    suspend fun flush(): Boolean = flushLock.withLock {
        var guard = 0
        while (pending.isNotEmpty() && guard++ < 60) {
            val batch = pending.take(Rules.MAX_VOTES_PER_SUBMIT)
            try {
                sink.submit(batch, today())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return@withLock false
            }
            repeat(batch.size) { pending.removeFirst() }
        }
        pending.isEmpty()
    }
}
