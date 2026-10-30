package space.affinix.app

import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.unit.Density
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
import org.jetbrains.skia.EncodedImageFormat
import space.affinix.app.i18n.Lang
import space.affinix.app.net.Api
import space.affinix.app.net.Config
import space.affinix.app.net.Duel
import space.affinix.app.net.MemoryKeyValueStore
import space.affinix.app.net.MemorySessionStore
import space.affinix.app.net.Session
import space.affinix.app.net.Specimen
import space.affinix.app.store.AppModel
import space.affinix.app.store.Mode
import space.affinix.app.store.Tab
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Renders the real screens offscreen (Skia, no window) with a fake server behind them and saves PNGs to build/shots, so every CI run
 * produces pictures of the app. Each shot must also contain real content (not a blank canvas).
 */
@OptIn(ExperimentalComposeUiApi::class)
class ScreenshotTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val outDir = File(System.getProperty("shots") ?: "build/shots").also { it.mkdirs() }

    private val dnaFixture = kotlinx.serialization.json.Json.parseToJsonElement(javaClass.getResource("/dna.json")!!.readText()) as kotlinx.serialization.json.JsonObject

    /** [marathon]: the daily ten is done and set 2 too, set 3 is half way; [dna]: the player has 90 answers on record */
    private fun model(signedIn: Boolean, marathon: Boolean = false, dna: Boolean = false): AppModel {
        val engine = MockEngine { req ->
            val body = when {
                req.url.encodedPath.endsWith("arena_test_mine") -> """[{"id":"t1","title":"Which logo for my coffee shop?","dim":"trust","status":"open","target":150,"votes":120,"voters":9,"items":[{"id":"i1","pos":0,"label":"Blue cup","wins":45,"games":60},{"id":"i2","pos":1,"label":"Orange bean","wins":20,"games":60},{"id":"i3","pos":2,"label":"Mono wordmark","wins":10,"games":60}]},{"id":"t2","title":"Slogan for the launch","dim":"preference","status":"closed","target":150,"votes":0,"voters":0,"items":[{"id":"i4","pos":0,"label":"Fresh start","wins":0,"games":0},{"id":"i5","pos":1,"label":"Own the morning","wins":0,"games":0}]}]"""
                req.url.encodedPath.endsWith("arena_test_results") -> """{"test":{"id":"t1","title":"Which logo for my coffee shop?","dim":"trust","status":"open","target":150,"votes":120,"voters":9,"items":[{"id":"i1","pos":0,"label":"Blue cup","wins":45,"games":60},{"id":"i2","pos":1,"label":"Orange bean","wins":20,"games":60},{"id":"i3","pos":2,"label":"Mono wordmark","wins":10,"games":60}]},"pairs":[{"a":"i1","b":"i2","aVotes":18,"bVotes":7},{"a":"i1","b":"i3","aVotes":19,"bVotes":6}],"avgMs":2400}"""
                req.url.encodedPath.endsWith("arena_test_queue") -> """{"available":2,"missionXp":24,"cap":300,"tests":[{"id":"q1","title":"Poster for a jazz night","dim":"attention","owner":{"id":"u3","name":"Dias","username":"dias"},"items":[{"id":"a1","pos":0,"label":"Neon","path":null},{"id":"a2","pos":1,"label":"Paper cut","path":null}],"pairs":[["a1","a2"]],"done":0,"total":1}]}"""
                marathon && req.url.encodedPath.endsWith("arena_state") -> """{"profile":{"xp":2840,"level":8,"votes":331,"eyeCorrect":18,"eyeTotal":25,"streak":4,"bestCombo":9,"visible":true,"badges":["first_vote","votes_100"]},"today":{"day":"${localDay()}","votes":27,"dailyVotes":10,"setVotes":[10,4,0,0,0],"familyVotes":{"card":22,"mark":5},"maxCombo":7,"slate":["votes_15","fam_5","combo_6"],"claimed":["votes_15","daily_set","set_2"]},"days":[]}"""
                dna && req.url.encodedPath.endsWith("arena_my_votes") -> if (String(req.body.toByteArray()).contains("\"${seasonOf()}\"")) """{"rows":[${(dnaFixture["votes"] as kotlinx.serialization.json.JsonArray).joinToString(",")}],"last":90,"more":false}""" else """{"rows":[],"last":0,"more":false}"""
                dna && req.url.encodedPath.endsWith("arena-traits") -> """{"order":${dnaFixture["order"]},"traits":${dnaFixture["traits"]}}"""
                req.url.encodedPath.endsWith("arena_state") -> """{"profile":{"xp":1240,"level":5,"votes":231,"eyeCorrect":18,"eyeTotal":25,"streak":4,"bestCombo":9,"visible":true,"badges":["first_vote","votes_100","streak_3","level_5","combo_8"]},"today":{"day":"2026-10-30","votes":16,"dailyVotes":4,"maxCombo":7,"eyeCorrect":2,"sec":0,"families":["mark","card","poster"],"dims":["trust","clarity"],"slate":["votes_15","fam_5","combo_6"],"claimed":["votes_15"]}}"""
                req.url.encodedPath.endsWith("arena_my_votes") -> """{"rows":[],"last":0,"more":false}"""
                req.url.encodedPath.endsWith("arena_leaderboard") -> """{"rows":[{"rank":1,"userId":"a","name":"Aigerim K.","xp":5120,"level":11,"isMe":false},{"rank":2,"userId":"b","name":"Dias","xp":4410,"level":10,"isMe":false},{"rank":3,"userId":"u1","name":"Me","xp":1240,"level":5,"isMe":true}],"me":{"rank":3,"xp":1240}}"""
                req.url.encodedPath.endsWith("/posts") -> """[{"id":"p1","author_id":"u2","body":"Which logo feels more trustworthy for a bank? I keep going back and forth between the calm blue and the bold orange.","created_at":"2026-10-30T09:12:36+00:00","updated_at":"2026-10-30T09:12:36+00:00","post_likes":[{"count":12}],"post_comments":[{"count":2}]},{"id":"p2","author_id":"u1","body":"Қазақша пост: бүгінгі күн сынағы өте қызық болды!","created_at":"2026-10-29T08:00:00+00:00","updated_at":"2026-10-29T08:00:00+00:00","post_likes":[{"count":3}],"post_comments":[{"count":0}]}]"""
                req.url.encodedPath.endsWith("/profiles_public") -> """[{"id":"u2","full_name":"Aigerim K.","username":"aigerim","role_title":"Brand designer"},{"id":"u1","full_name":"Me","username":"me"},{"id":"u3","full_name":"Dias","username":"dias"},{"id":"u5","full_name":"Madina S.","username":"madina"}]"""
                req.url.encodedPath.endsWith("/post_likes") -> """[{"post_id":"p1"}]"""
                req.url.encodedPath.endsWith("/post_saves") -> """[{"post_id":"p2"}]"""
                req.url.encodedPath.endsWith("/post_comments") -> """[{"id":"c1","post_id":"p1","author_id":"u3","body":"Blue, but make the type bolder.","created_at":"2026-10-30T09:20:00+00:00"},{"id":"c2","post_id":"p1","author_id":"u1","body":"Agree, orange feels like a fintech.","created_at":"2026-10-30T09:25:00+00:00"}]"""
                req.url.encodedPath.endsWith("/profiles") -> """[{"full_name":"Nurlan K.","username":"nurlan","role_title":"Head of Research","bio":"I like clean marks and honest data."}]"""
                req.url.encodedPath.endsWith("/notifications") -> """[{"id":"n1","type":"comment","post_id":"p1","actor_id":"u2","is_read":false,"created_at":"2026-10-30T09:00:00+00:00","comment":{"body":"Blue, but make the type bolder."}},{"id":"n2","type":"friend_request","actor_id":"u3","is_read":false,"created_at":"2026-10-29T09:00:00+00:00"},{"id":"n3","type":"friend_accept","actor_id":"u5","is_read":true,"created_at":"2026-10-25T09:00:00+00:00"}]"""
                req.url.encodedPath.endsWith("/friendships") -> """[{"id":"f1","requester_id":"u1","addressee_id":"u2","status":"accepted","created_at":"2026-10-01T10:00:00+00:00"},{"id":"f2","requester_id":"u3","addressee_id":"u1","status":"pending","created_at":"2026-10-02T10:00:00+00:00"},{"id":"f3","requester_id":"u1","addressee_id":"u5","status":"pending","created_at":"2026-10-03T10:00:00+00:00"}]"""
                req.url.encodedPath.endsWith("/conversations") -> """[{"id":"c1","user_a":"u1","user_b":"u2","last_message_body":"See you at the review tomorrow","last_message_at":"2026-10-30T09:00:00+00:00","last_message_sender_id":"u2"},{"id":"c2","user_a":"u3","user_b":"u1","last_message_body":"Thanks!","last_message_at":"2026-10-29T09:00:00+00:00","last_message_sender_id":"u1"}]"""
                req.url.encodedPath.endsWith("/conversation_prefs") -> """[{"conversation_id":"c2","pinned_at":"2026-10-20T09:00:00+00:00","muted":true}]"""
                req.url.encodedPath.endsWith("my_unread_counts") -> """[{"conversation_id":"c1","unread":2}]"""
                req.url.encodedPath.endsWith("/messages") -> """[{"id":"m3","conversation_id":"c1","sender_id":"u2","body":"See you at the review tomorrow","created_at":"2026-10-30T09:00:00+00:00"},{"id":"m2","conversation_id":"c1","sender_id":"u1","body":"Sent the new logo variants, the blue one is my favourite.","created_at":"2026-10-30T08:55:00+00:00","read_at":"2026-10-30T08:56:00+00:00","reply_to_id":"m1","reply":{"id":"m1","sender_id":"u2","body":"Hi! Did you look at the poster test results?","attachment_path":null,"deleted_at":null},"reactions":[{"user_id":"u2","emoji":"👍"},{"user_id":"u1","emoji":"❤️"}]},{"id":"m1","conversation_id":"c1","sender_id":"u2","body":"Hi! Did you look at the poster test results?","created_at":"2026-10-30T08:50:00+00:00"}]"""
                req.url.encodedPath.endsWith("arena_tallies") -> """[{"pair":"202610/poster/975-980","dim":"clarity","a":31,"b":12}]"""
                else -> "{}"
            }
            respond(body, HttpStatusCode.OK, json)
        }
        val session = if (signedIn) Session("a", "r", Long.MAX_VALUE / 4, "u1", "me@affinix.space") else null
        val api = Api(HttpClient(engine), Config(), MemorySessionStore(session))
        return AppModel(api, CoroutineScope(SupervisorJob() + Dispatchers.Default), MemoryKeyValueStore())
    }

    private fun swatch(a: Color, b: Color): ImageBitmap {
        val bmp = ImageBitmap(480, 360)
        val c = Canvas(bmp)
        val p = Paint().apply { color = a }
        c.drawRect(0f, 0f, 480f, 360f, p)
        p.color = b
        c.drawCircle(Offset(240f, 180f), 100f, p)
        return bmp
    }

    private val duels = listOf(
        Duel("d1", "202610", "poster", "clarity", 975, 980, "202610/poster/975-980", swap = true, objective = true, daily = true, truth = 1,
            specimens = listOf(Specimen("grid / Fresh start", 4.7, 0.58), Specimen("grid / Өз қолыңмен", 7.3, 0.51))),
        Duel("d2", "202610", "mark", "trust", 12, 40, "202610/mark/12-40", daily = true, specimens = listOf(Specimen("a"), Specimen("b"))),
    )

    private fun shoot(name: String, w: Int, h: Int, m: AppModel, settle: () -> Unit = {}) {
        val scene = ImageComposeScene(width = w, height = h, density = Density(1f)) { App(m) }
        try {
            var t = 0L
            fun frames(n: Int) { repeat(n) { Thread.sleep(30); t += 30_000_000L; scene.render(t) } }
            frames(25)       // fonts and resources load asynchronously
            settle(); frames(15)
            val img = scene.render(t + 30_000_000L)
            File(outDir, "$name.png").writeBytes(img.encodeToData(EncodedImageFormat.PNG)!!.bytes)
            val px = org.jetbrains.skia.Bitmap().also { it.allocN32Pixels(img.width, img.height) }.also { img.readPixels(it) }
            val bg = px.getColor(2, 2)
            var other = 0
            for (y in 0 until img.height step 3) for (x in 0 until img.width step 3) if (px.getColor(x, y) != bg) other++
            assertTrue(other > 400, "$name looks empty ($other non-background samples)")
        } finally { scene.close() }
    }

    private fun primeRound(m: AppModel) {
        duels.forEachIndexed { i, d ->
            m.images["${d.season}/${d.family}/${d.a}"] = swatch(if (i == 0) Color(0xFF223355) else Color(0xFF552233), Color(0xFFFF6A1F))
            m.images["${d.season}/${d.family}/${d.b}"] = swatch(Color(0xFFEEEEEE), Color(0xFF111111))
        }
        m.game.start(Mode.Daily, duels)
    }

    @Test fun login() { shoot("01-login-phone", 420, 820, model(false)); shoot("01-login-desktop", 1000, 700, model(false)) }

    @Test fun home() { shoot("02-home-phone", 420, 900, model(true)); shoot("02-home-desktop", 1000, 760, model(true)) }

    @Test fun duelChoose() { val m = model(true); primeRound(m); shoot("03-duel-choose-phone", 420, 1100, m); shoot("03-duel-choose-desktop", 1000, 760, m) }

    @Test fun duelReveal() {
        val m = model(true); primeRound(m)
        shoot("04-duel-reveal-phone", 420, 1300, m) { Thread.sleep(700); m.vote(0) }
    }

    @Test fun duelRevealKazakh() {
        val m = model(true); m.changeLang(Lang.Kk); primeRound(m)
        shoot("05-duel-reveal-kk-desktop", 1000, 900, m) { Thread.sleep(700); m.vote(1) }
    }

    @Test fun summary() {
        val m = model(true); primeRound(m)
        shoot("06-summary-phone", 420, 820, m) { repeat(2) { Thread.sleep(700); m.vote(0); m.game.next() } }
    }

    @Test fun rankings() { val m = model(true); m.tab = Tab.Rankings; shoot("07-rankings-phone", 420, 820, m) }

    @Test fun profile() { val m = model(true); m.tab = Tab.Profile; shoot("08-profile-phone", 420, 1500, m) }

    @Test fun marathon() { shoot("17-marathon-phone", 420, 1500, model(true, marathon = true)) { Thread.sleep(600) } }

    @Test fun researchList() { val m = model(true); m.tab = Tab.Research; shoot("19-research-phone", 420, 1100, m) { Thread.sleep(600) } }

    @Test fun researchResults() {
        val m = model(true); m.tab = Tab.Research
        shoot("20-research-results-phone", 420, 1500, m) { Thread.sleep(500); m.crowd.open("t1"); Thread.sleep(700) }
    }

    @Test fun researchCreate() {
        val m = model(true); m.tab = Tab.Research
        shoot("21-research-create-phone", 420, 1300, m) { Thread.sleep(400); m.crowd.view = space.affinix.app.store.CrowdModel.View.Create }
    }

    @Test fun missionHome() { shoot("22-mission-home-phone", 420, 1500, model(true, marathon = true)) { Thread.sleep(700) } }

    @Test fun missionDuel() {
        val m = model(true, marathon = true)
        shoot("23-mission-duel-phone", 420, 900, m) {
            Thread.sleep(700); m.mission.loadQueue(); Thread.sleep(600)
            m.mission.queue?.tests?.firstOrNull()?.let { m.mission.start(it) }
        }
    }

    @Test fun tasteDna() {
        val m = model(true, dna = true); m.tab = Tab.Profile
        shoot("18-dna-phone", 420, 2100, m) { Thread.sleep(900) }
    }

    @Test fun feed() {
        val m = model(true); m.tab = Tab.Feed
        shoot("09-feed-phone", 420, 1500, m) { Thread.sleep(500); m.feed.posts.firstOrNull()?.let { m.feed.toggleComments(it) } }
    }

    @Test fun people() {
        val m = model(true); m.tab = Tab.People
        shoot("10-people-phone", 420, 1000, m)
    }

    @Test fun peopleSearch() {
        val m = model(true); m.tab = Tab.People
        shoot("11-people-search-phone", 420, 700, m) { Thread.sleep(400); m.people.search("dias") }
    }

    @Test fun chatsList() {
        val m = model(true); m.tab = Tab.Chats
        shoot("12-chats-phone", 420, 820, m)
    }

    @Test fun thread() {
        val m = model(true); m.tab = Tab.Chats
        shoot("13-thread-phone", 420, 820, m) { Thread.sleep(500); m.messages.conversations.firstOrNull()?.let { m.messages.openChat(it) }; Thread.sleep(600) }
    }

    @Test fun quests() {
        val m = model(true); m.tab = Tab.Quests
        shoot("14-quests-phone", 420, 900, m)
    }

    @Test fun notifications() {
        val m = model(true); m.tab = Tab.Notifications
        shoot("15-notifications-phone", 420, 700, m)
    }

    @Test fun homeWithBell() {
        val m = model(true)
        shoot("16-home-bell-phone", 420, 900, m) { m.notifications.refresh(); Thread.sleep(500) }
    }
}
