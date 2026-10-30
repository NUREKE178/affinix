package space.affinix.app

import kotlinx.coroutines.test.runTest
import space.affinix.app.net.Duel
import space.affinix.app.net.Specimen
import space.affinix.app.net.Tally
import space.affinix.app.net.TallyQuery
import space.affinix.app.net.WireVote
import space.affinix.app.store.Game
import space.affinix.app.store.Mode
import space.affinix.app.store.Phase
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class FakeSink(var failSubmit: Boolean = false, var tallies: List<Tally> = emptyList()) : Game.Sink {
    val submitted = mutableListOf<List<WireVote>>()
    override suspend fun tallies(items: List<TallyQuery>) = tallies
    override suspend fun submit(votes: List<WireVote>, day: String) {
        if (failSubmit) error("offline")
        submitted += votes
    }
}

private fun duel(i: Int, swap: Boolean = false, objective: Boolean = false, truth: Int? = null, repeat: Boolean = false) = Duel(
    id = "d$i", season = "202610", family = "mark", dim = if (objective) "clarity" else "preference", a = i, b = i + 1,
    pair = "202610/mark/$i-${i + 1}", swap = swap, objective = objective, repeat = repeat, daily = true, truth = truth,
    specimens = listOf(Specimen("A"), Specimen("B")),
)

class GameTest {
    private var clock = 1_000_000L
    private var ids = 0
    private fun game(sink: Game.Sink) = Game(sink, now = { clock }, newId = { "id${ids++}" }, today = { "2026-10-30" })

    @Test fun voteMapsTheScreenSideBackToTheCanonicalSide() {
        val g = game(FakeSink())
        g.start(Mode.Daily, listOf(duel(1, swap = true)))
        clock += 2000
        g.vote(0) // left on screen is canonical b when swapped
        val r = g.round.value!!
        assertEquals(Phase.Reveal, r.phase)
        assertEquals(1, r.last!!.pick)
        assertEquals(0, r.last!!.side)
    }

    @Test fun xpComboAndPioneerFollowTheWebRules() = runTest {
        val sink = FakeSink(tallies = listOf(Tally("202610/mark/1-2", "preference", 0, 0)))
        val g = game(sink)
        g.start(Mode.Daily, listOf(duel(1), duel(3), duel(5), duel(7)))
        g.loadTallies()
        val xps = mutableListOf<Int>()
        repeat(4) { clock += 2000; g.vote(0); xps += g.round.value!!.last!!.xp; g.next() }
        // duel 1 has an empty tally => pioneer (+5); combo reaches 3 on the third vote => +1
        assertEquals(listOf(15, 10, 11, 12), xps)
        assertEquals(Phase.Summary, g.round.value!!.phase)
        assertEquals(48, g.round.value!!.xp)
        assertEquals(4, g.round.value!!.bestCombo)
    }

    @Test fun anInstantAnswerBreaksTheComboAndEarnsNoBonus() {
        val g = game(FakeSink())
        g.start(Mode.Free, listOf(duel(1), duel(3)))
        clock += 100
        g.vote(1)
        assertEquals(0, g.round.value!!.last!!.combo)
        assertEquals(10, g.round.value!!.last!!.xp)
    }

    @Test fun crowdMatchNeedsEnoughVotesAndNoTie() = runTest {
        val sink = FakeSink(tallies = listOf(Tally("202610/mark/1-2", "preference", 7, 3), Tally("202610/mark/3-4", "preference", 3, 1), Tally("202610/mark/5-6", "preference", 4, 4)))
        val g = game(sink)
        g.start(Mode.Free, listOf(duel(1), duel(3), duel(5)))
        g.loadTallies()
        clock += 2000; g.vote(0); assertEquals(true, g.round.value!!.last!!.crowd); g.next()
        clock += 2000; g.vote(0); assertNull(g.round.value!!.last!!.crowd); g.next()  // 4 earlier votes: too few to mean anything
        clock += 2000; g.vote(0); assertNull(g.round.value!!.last!!.crowd)            // a tie says nothing
    }

    @Test fun objectiveDuelsScoreTheEyeAndRepeatsGiveNothing() {
        val g = game(FakeSink())
        g.start(Mode.Daily, listOf(duel(1, objective = true, truth = 1), duel(3, repeat = true)))
        clock += 2000; g.vote(1)
        assertEquals(true, g.round.value!!.last!!.eye)
        g.next()
        clock += 2000; g.vote(0)
        assertEquals(0, g.round.value!!.last!!.xp)
        assertEquals(1, g.pendingCount) // the repeat is not sent
    }

    @Test fun skipAdvancesWithoutAVoteAndResetsTheCombo() {
        val g = game(FakeSink())
        g.start(Mode.Free, listOf(duel(1), duel(3)))
        g.skip()
        val r = g.round.value!!
        assertEquals(1, r.idx); assertEquals(1, r.skipped); assertEquals(0, g.pendingCount)
    }

    @Test fun flushKeepsVotesWhenOfflineAndSendsThemLater() = runTest {
        val sink = FakeSink(failSubmit = true)
        val g = game(sink)
        g.start(Mode.Daily, listOf(duel(1), duel(3)))
        clock += 2000; g.vote(0); g.next(); clock += 2000; g.vote(1)
        assertFalse(g.flush())
        assertEquals(2, g.pendingCount)
        sink.failSubmit = false
        assertTrue(g.flush())
        assertEquals(0, g.pendingCount)
        assertEquals(listOf("id0", "id1"), sink.submitted.flatten().map { it.id })
        assertEquals(listOf(0, 1), sink.submitted.flatten().map { it.pick })
        assertNotNull(sink.submitted.first().first().day)
    }

    @Test fun emptyDealMeansNoRound() {
        val g = game(FakeSink())
        g.start(Mode.Daily, emptyList())
        assertNull(g.round.value)
    }
}
