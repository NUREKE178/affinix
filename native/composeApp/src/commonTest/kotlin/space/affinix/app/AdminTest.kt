package space.affinix.app

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import space.affinix.app.net.Api
import space.affinix.app.net.Config
import space.affinix.app.net.MemorySessionStore
import space.affinix.app.net.Session
import space.affinix.app.store.AdminModel
import space.affinix.app.store.AdminModel.Status
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val jsonHeader = headersOf(HttpHeaders.ContentType, "application/json")

/** the admin panel's model against a mock server that answers the way the database functions of migration 0025 do */
class AdminTest {
    private class Rig(val handler: (path: String, body: String) -> Pair<Int, String>) {
        val seen = mutableListOf<String>()
        val model: AdminModel
        init {
            val engine = MockEngine { req ->
                val body = String(req.body.toByteArray())
                synchronized(seen) { seen += "${req.method.value} ${req.url.encodedPath}?${req.url.encodedQuery} $body" }
                val (status, out) = handler(req.url.encodedPath, body)
                respond(out, HttpStatusCode.fromValue(status), jsonHeader)
            }
            val api = Api(HttpClient(engine), Config(supabaseUrl = "https://sb.test", anonKey = "anon", apiBase = "https://api.test"), MemorySessionStore(Session("a", "r", Long.MAX_VALUE / 4, "me", "me@x.kz")), nowSeconds = { 1000 })
            model = AdminModel(api, CoroutineScope(SupervisorJob() + Dispatchers.Default)) { "me" }
        }
        fun log() = synchronized(seen) { seen.toList() }
    }

    private suspend fun until(cond: () -> Boolean) = withContext(Dispatchers.Default) { withTimeout(8000) { while (!cond()) delay(10) } }

    private fun ok(body: String) = 200 to body

    private val overviewJson = """{"users":120,"newUsers7d":9,"active7d":41,"admins":3,"companies":14,"experiments":22,"responses":1500,"posts":80,"comments":210,"messages7d":640,"friendships":96,"arenaPlayers":58,"testsOpen":5,"testsFlagged":2}"""
    private val statsJson = """{"players":58,"votes":9000,"tests":7,"testVotes":420,"days":[{"day":"2026-10-30","players":20,"votes":300,"missions":10,"avgMinutes":4.5,"over1h":2,"over3h":0},{"day":"2026-10-31","players":30,"votes":600,"missions":12,"avgMinutes":6.5,"over1h":4,"over3h":1}]}"""
    private fun person(id: String, name: String, admin: Boolean = false, owner: Boolean = false, total: Int = 2) =
        """{"id":"$id","full_name":"$name","username":"${name.lowercase()}","email":"${name.lowercase()}@x.kz","avatar_url":null,"is_admin":$admin,"is_owner":$owner,"created_at":"2026-10-01T10:00:00+00:00","org_name":"Acme","org_role":"owner","posts":3,"xp":1200,"total":$total}"""

    @Test fun anAdministratorIsRecognisedByTheProfileRow() = runTest {
        val r = Rig { path, _ -> if (path.endsWith("/profiles")) ok("""[{"is_admin":true,"is_owner":true}]""") else ok("[]") }
        r.model.loadMe(); until { r.model.meLoaded }
        assertTrue(r.model.isAdmin && r.model.isOwner)
        assertTrue(r.log().first().contains("id=eq.me") && r.log().first().contains("is_admin"))
    }

    @Test fun aDatabaseWithoutTheAdminColumnsMeansNoAdminPanel() = runTest {
        val r = Rig { _, _ -> 400 to """{"message":"column profiles.is_admin does not exist"}""" }
        r.model.loadMe(); until { r.model.meLoaded }
        assertTrue(!r.model.isAdmin && !r.model.isOwner)
    }

    @Test fun theOverviewAndTheArenaNumbersAreRead() = runTest {
        val r = Rig { path, _ -> if (path.endsWith("admin_overview")) ok(overviewJson) else if (path.endsWith("arena_admin_stats")) ok(statsJson) else ok("[]") }
        r.model.loadOverview(); until { r.model.stats != null }
        val o = r.model.overview!!
        assertEquals(listOf(120, 9, 41, 3), listOf(o.users, o.newUsers7d, o.active7d, o.admins))
        assertEquals(listOf(80, 210, 640, 96), listOf(o.posts, o.comments, o.messages7d, o.friendships))
        assertEquals(listOf(14, 22, 1500), listOf(o.companies, o.experiments, o.responses))
        assertEquals(listOf(58, 5, 2), listOf(o.arenaPlayers, o.testsOpen, o.testsFlagged))
        assertEquals(listOf(300, 600), r.model.stats!!.days.map { it.votes })
        assertEquals(6.5, r.model.stats!!.days.last().avgMinutes)
        assertTrue(r.log().any { it.contains("arena_admin_stats") && it.contains("\"p_days\":14") })
    }

    @Test fun anOverviewWithoutTheArenaStatsStillShows() = runTest {
        val r = Rig { path, _ -> if (path.endsWith("admin_overview")) ok(overviewJson) else 404 to """{"message":"Could not find the function public.arena_admin_stats"}""" }
        r.model.loadOverview(); until { r.model.overviewStatus == Status.Ready }
        delay(100)
        assertNull(r.model.stats)
    }

    @Test fun somebodyWhoIsNotAnAdministratorIsToldSo() = runTest {
        val r = Rig { _, _ -> 403 to """{"code":"42501","message":"not_admin"}""" }
        r.model.loadOverview(); until { r.model.overviewStatus == Status.Error }
        assertEquals("noAccess", r.model.overviewError)
    }

    @Test fun aServerWithoutMigration0025SaysItIsNotConnectedYet() = runTest {
        val r = Rig { _, _ -> 404 to """{"code":"PGRST202","message":"Could not find the function public.admin_overview in the schema cache"}""" }
        r.model.loadOverview(); until { r.model.overviewStatus == Status.Error }
        assertEquals("updatePending", r.model.overviewError)
    }

    @Test fun searchingAsksTheServerAfterAPauseAndPagesAppendWithoutDuplicates() = runTest {
        val r = Rig { path, body ->
            if (path.endsWith("admin_users")) ok(if (body.contains("\"p_offset\":0")) "[${person("u1", "Aigerim", total = 45)},${person("u2", "Dias", total = 45)}]" else "[${person("u2", "Dias", total = 45)},${person("u3", "Madina", total = 45)}]")
            else ok("[]")
        }
        r.model.search("ai")
        r.model.search("aigerim") // typing on: only the last box content is asked
        until { r.model.peopleStatus == Status.Ready }
        assertEquals(1, r.log().count { it.contains("admin_users") })
        val first = r.log().first { it.contains("admin_users") }
        assertTrue(first.contains("\"p_query\":\"aigerim\"") && first.contains("\"p_limit\":30") && first.contains("\"p_offset\":0"), first)
        assertEquals(45, r.model.peopleTotal)
        assertEquals(listOf("Aigerim", "Dias"), r.model.people.map { it.label })
        r.model.loadMore(); until { r.model.people.size == 3 }
        assertEquals(listOf("u1", "u2", "u3"), r.model.people.map { it.id })
        assertTrue(r.log().last { it.contains("admin_users") }.contains("\"p_offset\":2"))
    }

    @Test fun theOwnerMakesAnAdministratorAndTheRowChangesAtOnce() = runTest {
        val r = Rig { path, _ -> if (path.endsWith("admin_users")) ok("[${person("u1", "Aigerim")},${person("u2", "Dias", admin = true)}]") else ok("null") }
        r.model.loadPeople(); until { r.model.peopleStatus == Status.Ready }
        r.model.setAdmin(r.model.people[0], true)
        until { r.model.people[0].isAdmin }
        val call = r.log().first { it.contains("admin_set_admin") }
        assertTrue(call.contains("\"p_user\":\"u1\"") && call.contains("\"p_admin\":true"), call)
        assertEquals("admin.people.granted", r.model.notice); assertEquals("Aigerim", r.model.noticeName)
        r.model.setAdmin(r.model.people[1], false)
        until { !r.model.people[1].isAdmin }
        assertEquals("admin.people.revoked", r.model.notice)
    }

    @Test fun aRefusedGrantKeepsTheRowAndSaysWhy() = runTest {
        val r = Rig { path, _ -> if (path.endsWith("admin_users")) ok("[${person("u1", "Aigerim")}]") else 400 to """{"message":"not_owner"}""" }
        r.model.loadPeople(); until { r.model.peopleStatus == Status.Ready }
        r.model.setAdmin(r.model.people[0], true)
        until { r.model.notice != null }
        assertEquals("admin.people.err.not_owner", r.model.notice)
        assertTrue(!r.model.people[0].isAdmin)
    }

    @Test fun theLogCarriesWhoDidWhatToWhomAndTheExcerpt() = runTest {
        val r = Rig { _, _ -> ok("""[{"id":7,"action":"post_removed","created_at":"2026-10-31T10:00:00+00:00","actor_id":"a","actor_name":"Nurlan","target_id":"b","target_name":"Dias","meta":{"excerpt":"spam spam"}},{"id":6,"action":"owner_set","created_at":"2026-10-01T10:00:00+00:00","actor_id":null,"actor_name":null,"target_id":"a","target_name":"Nurlan","meta":{}}]""") }
        r.model.loadLog(); until { r.model.logStatus == Status.Ready }
        assertEquals(listOf("post_removed", "owner_set"), r.model.log.map { it.action })
        assertEquals(listOf("Nurlan", null), r.model.log.map { it.actor })
        assertEquals("spam spam", r.model.log[0].excerpt); assertNull(r.model.log[1].excerpt)
        assertTrue(r.log().first().contains("\"p_limit\":60"))
    }

    private val moderationHandler: (String, String) -> Pair<Int, String> = { path, _ ->
        when {
            path.endsWith("arena_test_flagged") -> ok("""[{"id":"t1","title":"Spam test","status":"flagged","note":null,"createdAt":"x","reports":3,"reasons":["spam","rude"],"owner":{"id":"u9","name":"Troll","username":"troll","avatarUrl":null},"items":[]}]""")
            path.endsWith("/post_comments") -> ok("""[{"id":"c1","post_id":"p1","author_id":"u1","body":"nice","created_at":"2026-10-31T09:00:00+00:00"},{"id":"c2","post_id":"p2","author_id":"u2","body":"hm","created_at":"2026-10-31T08:00:00+00:00"}]""")
            path.endsWith("/posts") -> ok("""[{"id":"p1","author_id":"u1","body":"hello","image_url":"https://x/y.png","created_at":"2026-10-31T09:00:00+00:00"},{"id":"p2","author_id":"u2","body":"second","created_at":"2026-10-31T08:00:00+00:00"}]""")
            path.endsWith("/profiles_public") -> ok("""[{"id":"u1","full_name":"Aigerim","username":"aigerim"},{"id":"u2","full_name":"Dias","username":"dias"}]""")
            else -> ok("null")
        }
    }

    @Test fun moderationShowsReportedTestsAndTheNewestPostsAndComments() = runTest {
        val r = Rig(moderationHandler)
        r.model.loadModeration(); until { r.model.moderationStatus == Status.Ready }
        assertEquals(listOf("Spam test"), r.model.flagged.map { it.title })
        assertEquals(3, r.model.flagged[0].reports); assertEquals(listOf("spam", "rude"), r.model.flagged[0].reasons); assertEquals("Troll", r.model.flagged[0].owner)
        assertEquals(listOf("hello", "second"), r.model.posts.map { it.body })
        assertEquals(listOf("Aigerim", "Dias"), r.model.posts.map { it.author.name })
        assertTrue(r.model.posts[0].hasImage && !r.model.posts[1].hasImage)
        assertTrue(r.log().any { it.contains("/posts?") && it.contains("limit=20") && it.contains("order=created_at.desc") })
    }

    @Test fun removingAPostDeletesTheRowAndItsCommentsLeaveTheList() = runTest {
        val r = Rig(moderationHandler)
        r.model.loadModeration(); until { r.model.moderationStatus == Status.Ready }
        r.model.removeContent(r.model.posts.first { it.id == "p1" })
        until { r.model.posts.none { it.id == "p1" } }
        assertTrue(r.log().any { it.startsWith("DELETE") && it.contains("/posts?id=eq.p1") })
        assertEquals(listOf("c2"), r.model.comments.map { it.id }) // c1 belonged to p1
        assertEquals("admin.moderation.removed", r.model.notice)
    }

    @Test fun aReportedTestIsRemovedOrRestoredThroughTheDatabaseFunction() = runTest {
        val r = Rig(moderationHandler)
        r.model.loadModeration(); until { r.model.moderationStatus == Status.Ready }
        r.model.moderateTest(r.model.flagged[0], "remove")
        until { r.log().count { it.contains("arena_test_flagged") } >= 2 } // it reloads afterwards
        val call = r.log().first { it.contains("arena_test_moderate") }
        assertTrue(call.contains("\"p_test\":\"t1\"") && call.contains("\"p_action\":\"remove\""), call)
    }
}
