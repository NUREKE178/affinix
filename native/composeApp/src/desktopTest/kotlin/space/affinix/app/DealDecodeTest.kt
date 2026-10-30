package space.affinix.app

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import space.affinix.app.net.ApiJson
import space.affinix.app.net.Duel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * deals.json holds what the website's own dealer (api/arena-deal.mjs) returns for 28 daily challenges, the 5 extra sets and 20 free rounds
 * (550 duels, every design family and question), generated with node. The app must be able to read all of it.
 */
class DealDecodeTest {
    private val cases: JsonArray = ApiJson.parseToJsonElement(javaClass.getResource("/deals.json")!!.readText()).jsonArray

    @Test fun everyDealFromTheServerDecodes() {
        var duels = 0
        for (c in cases) {
            val o: JsonObject = c.jsonObject
            val list = ApiJson.decodeFromString(ListSerializer(Duel.serializer()), o["v"].toString())
            assertTrue(list.isNotEmpty(), o["k"]!!.jsonPrimitive.content)
            for (d in list) {
                assertEquals(2, d.specimens.size, "${o["k"]} ${d.id}")
                assertTrue(d.pair.startsWith(d.season + "/" + d.family + "/"), d.pair)
                if (d.objective) { assertTrue(d.truth == 0 || d.truth == 1, "objective duel without a truth: ${d.id}"); assertTrue(d.specimens.all { it.contrast != null }, "no contrast: ${d.id}") }
            }
            duels += list.size
        }
        assertEquals(550, duels)
    }

    @Test fun aDailyChallengeHasTenDuels() {
        val daily = cases.filter { it.jsonObject["k"]!!.jsonPrimitive.content.startsWith("daily") }
        assertTrue(daily.all { it.jsonObject["v"]!!.jsonArray.size == 10 })
    }
}
