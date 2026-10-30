package space.affinix.app

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import space.affinix.app.net.Api
import space.affinix.app.net.Config
import space.affinix.app.net.MemorySessionStore
import space.affinix.app.net.Session
import space.affinix.app.store.FeedModel
import space.affinix.app.store.Moderation
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val json = headersOf(HttpHeaders.ContentType, "application/json")

class ModerationTest {
    @Test fun cleanTextPasses() = assertEquals(Moderation.Action.Clean, Moderation.moderate("Хороший день, design!").action)

    @Test fun oneWordIsStarredOut() {
        val v = Moderation.moderate("this is shit ok")
        assertEquals(Moderation.Action.Censor, v.action); assertEquals("this is s*** ok", v.text)
    }

    @Test fun twoWordsBlockThePost() = assertEquals(Moderation.Action.Block, Moderation.moderate("fuck this shit").action)

    @Test fun inflectedRussianAndYoAreCaught() {
        assertEquals(Moderation.Action.Censor, Moderation.moderate("ты мудак").action)
        assertEquals(Moderation.Action.Censor, Moderation.moderate("Ёбаный").action)
    }

    @Test fun aStemInsideAnotherWordIsNotAMatch() = assertEquals(Moderation.Action.Clean, Moderation.moderate("classic assist scunthorpe").action)
}

class TimeTest {
    @Test fun isoWithMicrosecondsAndZeroOffset() = assertEquals(1793351556123L, epochOfIso("2026-10-30T09:12:36.123456+00:00"))
    @Test fun offsetsAreApplied() = assertEquals(1793333556000L, epochOfIso("2026-10-30T09:12:36+05:00"))
    @Test fun zuluAndLeapDays() { assertEquals(1772323199000L, epochOfIso("2026-02-28T23:59:59Z")); assertEquals(daysFromCivil(2024, 2, 29), 19782L) }
    @Test fun garbageIsNull() = assertNull(epochOfIso("yesterday"))
}

class FeedTest {
    private val config = Config(supabaseUrl = "https://sb.test", anonKey = "anon", apiBase = "https://api.test")

    private fun feed(handler: (path: String, method: HttpMethod, query: String, body: String) -> String, seen: MutableList<String> = mutableListOf()): FeedModel {
        val engine = MockEngine { req ->
            val body = String(req.body.toByteArray())
            seen += "${req.method.value} ${req.url.encodedPath}?${req.url.encodedQuery} $body"
            respond(handler(req.url.encodedPath, req.method, req.url.encodedQuery, body), HttpStatusCode.OK, json)
        }
        val api = Api(HttpClient(engine), config, MemorySessionStore(Session("a", "r", Long.MAX_VALUE / 4, "me", "me@x.kz")), nowSeconds = { 1000 })
        return FeedModel(api, kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob())) { "me" }
    }

    private val posts = """[{"id":"p1","author_id":"u2","body":"Hello","image_url":null,"created_at":"2026-10-30T09:12:36.123456+00:00","updated_at":"2026-10-30T09:12:36.123456+00:00","post_likes":[{"count":3}],"post_comments":[{"count":1}]},
        {"id":"p2","author_id":"me","body":"Mine","created_at":"2026-10-29T08:00:00+00:00","updated_at":"2026-10-29T09:30:00+00:00","post_likes":[{"count":0}],"post_comments":[{"count":0}]}]"""

    private fun reply(path: String): String = when {
        path.endsWith("/posts") -> posts
        path.endsWith("/profiles_public") -> """[{"id":"u2","full_name":"Dias","username":"dias","avatar_url":null,"role_title":"Designer"},{"id":"me","full_name":"Me","username":"me"}]"""
        path.endsWith("/post_likes") -> """[{"post_id":"p1"}]"""
        path.endsWith("/post_saves") -> "[]"
        else -> "[]"
    }

    @Test fun firstPageIsReadWithTheSameQueryAsTheWebsite() = runTest {
        val seen = mutableListOf<String>()
        val f = feed({ p, _, _, _ -> reply(p) }, seen)
        f.loadNow()
        val first = seen.first { it.contains("/posts?") }
        assertTrue(first.contains("select=*,post_likes(count),post_comments(count)") || first.contains("select=%2A") || first.contains("post_likes%28count%29"), first)
        assertTrue(first.contains("order=created_at.desc") && first.contains("limit=30"), first)
        assertEquals(2, f.posts.size)
        val p1 = f.posts[0]
        assertEquals("Dias", p1.author.name); assertEquals(3, p1.likes); assertEquals(1, p1.comments); assertTrue(p1.liked); assertTrue(!p1.saved); assertTrue(!p1.edited)
        assertTrue(f.posts[1].edited) // updated_at differs from created_at
        assertTrue(f.loaded && !f.hasMore)
    }

    @Test fun theNextPageAsksForOlderPostsAndEncodesThePlusOfTheOffset() = runTest {
        val seen = mutableListOf<String>()
        val f = feed({ p, _, _, _ -> reply(p) }, seen)
        f.page("2026-10-30T09:12:36.123456+00:00")
        val q = seen.first { it.contains("/posts?") }
        assertTrue(q.contains("created_at=lt.2026-10-30T09:12:36.123456%2B00:00") || q.contains("created_at=lt.2026-10-30T09%3A12%3A36.123456%2B00%3A00"), q)
    }

    @Test fun likingChangesTheCardAtOnce() = runTest {
        val f = feed({ p, _, _, _ -> reply(p) })
        f.loadNow()
        val p2 = f.posts[1]
        f.toggleLike(p2)
        assertTrue(f.posts[1].liked); assertEquals(1, f.posts[1].likes)
    }

    @Test fun aBlockedPostIsNotSent() = runTest {
        val seen = mutableListOf<String>()
        val f = feed({ p, _, _, _ -> reply(p) }, seen)
        assertEquals("feed.profanityBlocked", f.publish("fuck this shit"))
        assertTrue(seen.none { it.startsWith("POST") })
    }

    @Test fun aCensoredPostIsSentWithTheStarredText() = runTest {
        val seen = mutableListOf<String>()
        val f = feed({ p, _, _, _ -> reply(p) }, seen)
        assertNull(f.publish("this is shit ok"))
        val post = seen.first { it.startsWith("POST") && it.contains("/posts?") }
        assertTrue(post.contains("\"body\":\"this is s*** ok\""), post)
        assertEquals("feed.postedCensored", f.notice)
    }

    @Test fun aCommentOnSomeoneElsesPostNotifiesTheirAuthor() = runTest {
        val seen = mutableListOf<String>()
        val f = feed({ p, m, _, _ -> if (m == HttpMethod.Post && p.endsWith("/post_comments")) """[{"id":"c9","post_id":"p1","author_id":"me","body":"Nice"}]""" else reply(p) }, seen)
        f.loadNow()
        assertNull(f.comment(f.posts[0], "Nice"))
        val note = seen.first { it.startsWith("POST") && it.contains("/notifications") }
        assertTrue(note.contains("\"recipient_id\":\"u2\"") && note.contains("\"comment_id\":\"c9\""), note)
        assertEquals(2, f.posts[0].comments)
    }

    @Test fun aCommentOnYourOwnPostNotifiesNobody() = runTest {
        val seen = mutableListOf<String>()
        val f = feed({ p, m, _, _ -> if (m == HttpMethod.Post && p.endsWith("/post_comments")) """[{"id":"c9","post_id":"p2","author_id":"me","body":"x"}]""" else reply(p) }, seen)
        f.loadNow()
        assertNull(f.comment(f.posts[1], "note to self"))
        assertTrue(seen.none { it.contains("/notifications") })
    }
}
