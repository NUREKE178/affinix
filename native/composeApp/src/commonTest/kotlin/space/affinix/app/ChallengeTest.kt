package space.affinix.app

import space.affinix.app.net.Duel
import space.affinix.app.net.Specimen
import space.affinix.app.store.Challenge
import space.affinix.app.store.Result
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChallengeTest {
    private val season = "202611"

    private fun answers(text: String) = text.split(',').map { p -> p.split(':').let { Challenge.Answer(it[0], it[1].toInt(), it[2].toInt(), it[3], it[4].toInt()) } }

    private fun duelOf(a: Challenge.Answer, objective: Boolean = false) = Duel(
        id = "${a.family}-${a.a}-${a.b}", season = season, family = a.family, dim = a.dim, a = a.a, b = a.b,
        pair = "$season/${a.family}/${a.a}-${a.b}", objective = objective, specimens = listOf(Specimen("A"), Specimen("B")),
    )

    private fun resultOf(a: Challenge.Answer, pick: Int, objective: Boolean = false) =
        Result(duelOf(a, objective), pick, pick, 10, 0, 0, null, null, false, 2000, null)

    // ---- the links the website makes and refuses ------------------------------------------------

    @Test fun everyLinkTheWebsiteMakesIsReadAndWrittenBackIdentically() {
        for (v in ChallengeVectors.good) {
            val parsed = assertNotNull(Challenge.decode(v.text), v.note)
            assertEquals(v.season, parsed.season, v.note)
            assertEquals(v.name, parsed.name, v.note)
            assertEquals(answers(v.answers), parsed.answers, v.note)
            assertEquals(v.text, Challenge.encode(parsed.season, parsed.answers, parsed.name), "${v.note}: the app writes the very same link")
        }
    }

    @Test fun everyLinkTheWebsiteRefusesIsRefused() {
        for ((note, text) in ChallengeVectors.bad) assertNull(Challenge.decode(text), note)
        assertNull(Challenge.decode(null))
    }

    @Test fun theSmallestAndLargestLinksAreTheLimits() {
        val five = ChallengeVectors.good.first { it.answers.count { c -> c == ',' } == 4 }
        assertNotNull(Challenge.decode(five.text))
        val a = answers(ChallengeVectors.good[0].answers)
        assertEquals(10, a.size)
        assertNull(Challenge.encode(season, a.take(4), "x"), "four answers are too few")
        assertNotNull(Challenge.encode(season, a.take(5), "x"))
        assertNull(Challenge.encode(season, a + a.first().copy(a = 900, b = 901), "x"), "eleven are too many")
        assertNull(Challenge.encode(season, a.take(4) + a[0], "x"), "the same duel twice")
        assertNull(Challenge.encode("2026", a, "x"), "a bad season")
    }

    @Test fun anEyeTestIsNeverPartOfATasteMatch() {
        val a = answers(ChallengeVectors.good[0].answers)
        assertFalse(Challenge.isShareable(a[0].copy(dim = "clarity")))
        assertNull(Challenge.encode(season, listOf(a[0].copy(dim = "clarity")) + a.drop(1), "x"))
        assertFalse(Challenge.isShareable(a[0].copy(a = 9, b = 3)), "the lower index comes first")
        assertFalse(Challenge.isShareable(a[0].copy(family = "banner")))
        assertFalse(Challenge.isShareable(a[0].copy(pick = 2)))
    }

    // ---- names -------------------------------------------------------------------------------------

    @Test fun aNameIsTheFirstWordWithoutInvisibleOrDirectionChangingCharacters() {
        assertEquals("Айгерим", Challenge.cleanName("  Айгерим   Сериккызы "))
        assertEquals("Aigerim", Challenge.cleanName("Ai​ger‮im"))
        assertEquals("Ali", Challenge.cleanName("Ali\u00A0Baba"), "a no-break space ends the first word too, as in JavaScript")
        assertEquals("", Challenge.cleanName("\u0000\u0007"))
        assertEquals("", Challenge.cleanName(null))
        assertEquals(Challenge.NAME_MAX, Challenge.cleanName("А".repeat(80)).length)
        val emoji = Challenge.cleanName("😀".repeat(40))
        assertEquals(Challenge.NAME_MAX * 2, emoji.length, "24 characters, each two UTF-16 units")
        assertFalse(emoji.last().isHighSurrogate(), "never cut in the middle of a character")
    }

    // ---- what a person pastes --------------------------------------------------------------------

    @Test fun theValueIsFoundInAnAddressInAMessageOrOnItsOwn() {
        val c = ChallengeVectors.good[0].text
        assertEquals(c, Challenge.param("https://affinix.space/?c=$c"))
        assertEquals(c, Challenge.param("Сравним вкусы? Сыграй мои 10 дуэлей: https://affinix.space/?c=$c\nИ узнай, насколько мы совпадаем."))
        assertEquals(c, Challenge.param("  $c  "))
        assertEquals(c, Challenge.param("https://affinix.space/?x=1&c=$c"))
        assertNull(Challenge.param("https://affinix.space/"))
        assertNull(Challenge.param("привет"))
        assertNull(Challenge.param(""))
        assertNull(Challenge.param(null))
    }

    // ---- the match -------------------------------------------------------------------------------

    @Test fun theMatchCountsPairsPickedTheSameWayAndTheOnesWhereTwoPeopleSplit() {
        val a = answers(ChallengeVectors.good[0].answers)
        val same = Challenge.matchOf(season, a, a.map { resultOf(it, it.pick) })
        assertEquals(Challenge.Match(10, 10, 100, emptyList(), List(10) { true }), same)
        val flipped = a.mapIndexed { i, x -> resultOf(x, if (i == 2 || i == 5 || i == 9) 1 - x.pick else x.pick) }
        val m = Challenge.matchOf(season, a, flipped)
        assertEquals(7, m.same); assertEquals(70, m.percent); assertEquals(listOf(2, 5, 9), m.splits)
        assertEquals(false, m.sameAt[2])
    }

    @Test fun aSkippedPairIsNotCountedForOrAgainst() {
        val a = answers(ChallengeVectors.good[0].answers)
        val m = Challenge.matchOf(season, a, a.drop(2).map { resultOf(it, it.pick) })
        assertEquals(8, m.compared); assertEquals(100, m.percent)
        assertNull(m.sameAt[0]); assertNull(m.sameAt[1])
        assertNull(Challenge.matchOf(season, a, emptyList()).percent)
    }

    @Test fun thePercentRoundsLikeTheWebsite() {
        val a = answers(ChallengeVectors.good[1].answers) // eight answers
        val r = a.mapIndexed { i, x -> resultOf(x, if (i == 0) 1 - x.pick else x.pick) } // 7 of 8 = 87.5 -> 88
        assertEquals(88, Challenge.matchOf(season, a, r).percent)
        val r5 = a.mapIndexed { i, x -> resultOf(x, if (i < 3) 1 - x.pick else x.pick) } // 5 of 8 = 62.5 -> 63
        assertEquals(63, Challenge.matchOf(season, a, r5).percent)
    }

    @Test fun theBandsAreNamedAtTheirBoundaries() {
        assertEquals("twins", Challenge.label(100)); assertEquals("twins", Challenge.label(90))
        assertEquals("close", Challenge.label(89)); assertEquals("close", Challenge.label(70))
        assertEquals("mixed", Challenge.label(60)); assertEquals("mixed", Challenge.label(40)); assertEquals("mixed", Challenge.label(null))
        assertEquals("opposite", Challenge.label(39)); assertEquals("opposite", Challenge.label(0))
    }

    // ---- what a round sends ----------------------------------------------------------------------

    @Test fun aRoundSendsWhatWasAnsweredWithoutEyeTestsAndNothingWhenFewerThanFive() {
        val a = answers(ChallengeVectors.good[0].answers)
        val results = a.map { resultOf(it, it.pick) }
        assertEquals(10, Challenge.answersOf(season, results).second.size)
        val withEye = results.mapIndexed { i, r -> if (i == 0) resultOf(a[0].copy(dim = "clarity"), 0, objective = true) else r }
        assertEquals(9, Challenge.answersOf(season, withEye).second.size)
        assertEquals(emptyList(), Challenge.answersOf(season, results.take(4)).second)
        assertEquals(season, Challenge.answersOf(season, results).first)
    }

    @Test fun aSeasonIsLiveForThisMonthAndLastMonthOnly() {
        fun at(y: Int, m: Int, d: Int) = daysFromCivil(y, m, d) * 86_400_000L
        assertTrue(Challenge.seasonIsLive("202611", at(2026, 11, 8)))
        assertTrue(Challenge.seasonIsLive("202610", at(2026, 11, 8)))
        assertFalse(Challenge.seasonIsLive("202609", at(2026, 11, 8)))
        assertFalse(Challenge.seasonIsLive("202612", at(2026, 11, 8)))
        assertTrue(Challenge.seasonIsLive("202512", at(2026, 1, 3)))
    }

    @Test fun aPairAlreadyAnsweredOrFromAnOldSeasonEarnsNothing() {
        val d = duelOf(answers(ChallengeVectors.good[0].answers)[0]).copy(daily = true, set = 3)
        val key = "${d.pair}|${d.dim}"
        assertFalse(Challenge.marked(listOf(d), emptySet(), live = true)[0].repeat)
        assertTrue(Challenge.marked(listOf(d), setOf(key), live = true)[0].repeat)
        assertTrue(Challenge.marked(listOf(d), emptySet(), live = false)[0].repeat)
        val m = Challenge.marked(listOf(d), emptySet(), live = true)[0]
        assertFalse(m.daily, "a challenge pair is a free-play pair for the server"); assertEquals(0, m.set)
    }
}
