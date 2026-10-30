package space.affinix.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import space.affinix.app.Rules
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel

@Composable
private fun QuestCard(title: String, tier: String?, progress: Float, counter: String?, xp: Int, done: Boolean, claimed: Boolean, onClaim: () -> Unit, busy: Boolean) {
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            tier?.let { Chip(it, Tone.Neutral) }
            Txt(title, 15, FontWeight.ExtraBold, C.g50, Modifier.weight(1f))
        }
        Spacer(Modifier.height(10.dp))
        Bar(progress)
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Txt(counter ?: "", 13, FontWeight.Bold, C.g400, Modifier.weight(1f))
            when {
                claimed -> Chip(t("arena.quests.claimed"), Tone.Ok)
                done -> KeyButton(t("arena.lobby.dailyClaim", "xp" to xp), onClaim, lit = true, enabled = !busy, compact = true)
                else -> Chip("+$xp ${t("app.xp")}", Tone.Neutral)
            }
        }
    }
}

@Composable
fun QuestsScreen(model: AppModel) {
    val day = model.today
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { model.refresh() }
    fun claim(id: String) { busy = true; failure = null; scope.launch { failure = model.claim(id); busy = false } }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        ArenaTabs(model)
        Column {
            Txt(t("arena.quests.today"), 22, FontWeight.ExtraBold, C.g50)
            Txt(t("arena.quests.resetNote"), 13, color = C.g500)
        }
        failure?.let { Chip(t(it), Tone.Bad) }
        val claimed = day?.claimed.orEmpty()
        if (model.quests.isEmpty()) Txt(t("common.loading"), 14, color = C.g500)
        for (q in model.quests) {
            val have = day?.metric(q.kind) ?: 0
            val target = q.target
            val minutes = q.kind == "time"
            val n = if (minutes) target / 60 else target
            QuestCard(
                t("arena.quest.${q.kind}", "n" to n), t("arena.tier.${q.tier.name.lowercase()}"), (have.toFloat() / target).coerceIn(0f, 1f),
                "${if (minutes) have / 60 else have.coerceAtMost(target)} / $n", q.xp, have >= target, q.id in claimed, { claim(q.id) }, busy,
            )
        }
        if (model.quests.size == 3) {
            val all = model.quests.all { it.id in claimed }
            QuestCard(t("arena.quests.clearTitle"), null, model.quests.count { it.id in claimed } / 3f, t("arena.quests.clearBody"), Rules.DAILY_CLEAR_BONUS, all, "daily_clear" in claimed, { claim("daily_clear") }, busy)
        }
        if (model.dailyComplete) QuestCard(t("arena.lobby.dailyTitle"), null, 1f, t("arena.lobby.dailyDone"), Rules.DAILY_SET_BONUS, true, "daily_set" in claimed, { claim("daily_set") }, busy)
    }
}
