package space.affinix.app

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import space.affinix.app.net.Api
import space.affinix.app.net.ApiJson
import space.affinix.app.net.Config
import space.affinix.app.net.MemoryKeyValueStore
import space.affinix.app.net.MemorySessionStore
import space.affinix.app.net.Session
import space.affinix.app.store.AppModel
import space.affinix.app.store.Taste
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * dna.json is what the website's own Taste DNA code (src/lib/arena/dna.js) computes for 90 fixed answers over 157 real specimens, recorded by
 * native/scripts/gen-dna-fixture.mjs. The app's port must agree to the last digit.
 */
class TasteTest {
    private val fx: JsonObject = ApiJson.parseToJsonElement(javaClass.getResource("/dna.json")!!.readText()).jsonObject
    private val traits: Map<String, DoubleArray> = fx["traits"]!!.jsonObject.mapValues { (_, v) -> v.jsonArray.map { it.jsonPrimitive.double }.toDoubleArray() }
    private val votes = fx["votes"]!!.jsonArray.map { v -> Triple(v.jsonArray[0].jsonPrimitive.content, v.jsonArray[1].jsonPrimitive.content, v.jsonArray[2].jsonPrimitive.int) }

    private fun answers(): List<Taste.Answer> = votes.map { (pair, dim, pick) ->
        val (s, f, ab) = pair.split("/"); val (a, b) = ab.split("-")
        Taste.Answer(dim, pick, traits["$s/$f/$a"]!!, traits["$s/$f/$b"]!!)
    }

    @Test fun theTraitOrderIsTheWebsites() {
        assertEquals(Taste.TRAITS, fx["order"]!!.jsonArray.map { it.jsonPrimitive.content })
    }

    @Test fun leansTypeAndStrengthsMatchTheWebsiteToTheLastDigit() {
        val r = Taste.build(answers())
        val exp = fx["expected"]!!.jsonObject
        assertEquals(exp["n"]!!.jsonPrimitive.int, r.all.n)
        val lean = Taste.leanOf(r.all)
        val want = exp["lean"]!!.jsonArray.map { it.jsonPrimitive.double }
        for (i in want.indices) assertTrue(abs(lean[i] - want[i]) < 1e-9, "trait ${Taste.TRAITS[i]}: ${lean[i]} vs ${want[i]}")
        assertEquals(exp["strength"]!!.jsonArray.map { it.jsonPrimitive.content }, lean.map { Taste.strength(it) })
        val type = Taste.archetypeOf(lean)
        assertEquals(exp["archetype"]!!.jsonObject["id"]!!.jsonPrimitive.content, type.id)
        assertTrue(abs(type.fit - exp["archetype"]!!.jsonObject["fit"]!!.jsonPrimitive.double) < 1e-9)
        assertTrue(abs(Taste.confidenceOf(r.all) - exp["confidence"]!!.jsonPrimitive.double) < 1e-12)
        assertEquals(exp["top"]!!.jsonArray.map { it.jsonObject["trait"]!!.jsonPrimitive.content }, Taste.topTraits(lean, 3).map { it.trait })
    }

    @Test fun eachQuestionHasItsOwnLean() {
        val r = Taste.build(answers())
        val per = fx["expected"]!!.jsonObject["byDimLean"]!!.jsonObject
        assertEquals(per.keys, r.byDim.keys)
        for ((dim, v) in per) {
            assertEquals(v.jsonObject["n"]!!.jsonPrimitive.int, r.byDim[dim]!!.n, dim)
            val lean = Taste.leanOf(r.byDim[dim]!!)
            v.jsonObject["lean"]!!.jsonArray.forEachIndexed { i, x -> assertTrue(abs(lean[i] - x.jsonPrimitive.double) < 1e-9, "$dim ${Taste.TRAITS[i]}") }
        }
    }

    @Test fun aQuestionJudgedDifferentlyStandsOut() {
        // everything is "warm" except the trust question, where the cool one is always picked
        val warm = doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0); val cool = doubleArrayOf(-1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        val list = List(40) { Taste.Answer("clarity", 0, warm, cool) } + List(20) { Taste.Answer("trust", 0, cool, warm) }
        val s = Taste.standout(Taste.build(list))
        assertNotNull(s)
        assertEquals("trust", s.dim); assertEquals("warm", s.trait); assertTrue(s.delta < 0)
        // too few answers in a question: nothing stands out
        assertNull(Taste.standout(Taste.build(List(40) { Taste.Answer("clarity", 0, warm, cool) } + List(5) { Taste.Answer("trust", 0, cool, warm) })))
    }

    @Test fun noAnswersMeansNoLean() {
        val lean = Taste.leanOf(Taste.Dna())
        assertTrue(lean.all { it == 0.0 })
        assertEquals(0.0, Taste.confidenceOf(Taste.Dna()))
    }

    // ---- the whole path: the player's answers and the specimens' traits come from the server, the DNA comes out ----------------------

    @Test fun theModelBuildsTheSameDnaFromWhatTheServersAnswer() = runTest {
        val season = seasonOf()
        val rows = "[" + votes.joinToString(",") { (p, d, k) -> """["$p","$d",$k,"2026-10-30T10:00:00Z"]""" } + "]"
        val traitJson = "{" + traits.entries.joinToString(",") { (k, v) -> "\"$k\":[${v.joinToString(",")}]" } + "}"
        val seen = mutableListOf<String>()
        val engine = MockEngine { req ->
            synchronized(seen) { seen += req.url.encodedPath }
            val body = when {
                req.url.encodedPath.endsWith("arena_my_votes") -> if (req.url.toString().isNotEmpty() && String(req.body.let { (it as io.ktor.http.content.TextContent).text.toByteArray() }).contains("\"$season\"")) """{"rows":$rows,"last":90,"more":false}""" else """{"rows":[],"last":0,"more":false}"""
                req.url.encodedPath.endsWith("arena-traits") -> """{"order":${fx["order"]},"traits":$traitJson}"""
                req.url.encodedPath.endsWith("arena_state") -> """{"profile":{"xp":100,"votes":90},"today":null}"""
                else -> "{}"
            }
            respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val api = Api(HttpClient(engine), Config(supabaseUrl = "https://sb.test", anonKey = "anon", apiBase = "https://api.test"), MemorySessionStore(Session("a", "r", Long.MAX_VALUE / 4, "me", "me@x.kz")), nowSeconds = { 1000 })
        val app = AppModel(api, CoroutineScope(SupervisorJob() + Dispatchers.Default), MemoryKeyValueStore())
        withContext(Dispatchers.Default) { withTimeout(5000) { while (app.profile == null) delay(10) } }
        app.loadDna()
        withContext(Dispatchers.Default) { withTimeout(5000) { while (app.dna == null && !app.dnaFailed) delay(10) } }
        val dna = app.dna
        assertNotNull(dna, "failed=${app.dnaFailed}")
        assertEquals(90, dna.all.n)
        val want = fx["expected"]!!.jsonObject["lean"]!!.jsonArray.map { it.jsonPrimitive.double }
        val lean = Taste.leanOf(dna.all)
        for (i in want.indices) assertTrue(abs(lean[i] - want[i]) < 1e-9)
        assertEquals(1, synchronized(seen) { seen.count { it.endsWith("arena-traits") } }) // one request for all 157 specimens
        // asking again with the same number of votes does nothing
        app.loadDna(); delay(150)
        assertEquals(1, synchronized(seen) { seen.count { it.endsWith("arena-traits") } })
    }
}
