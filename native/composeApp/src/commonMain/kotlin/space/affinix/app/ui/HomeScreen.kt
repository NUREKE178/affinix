package space.affinix.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.painterResource
import space.affinix.app.Rules
import space.affinix.app.i18n.t
import space.affinix.app.res.Res
import space.affinix.app.res.logo
import space.affinix.app.store.AppModel

@Composable
fun LevelHeader(model: AppModel, modifier: Modifier = Modifier) {
    val p = model.profile
    val prog = Rules.levelProgress(p?.xp ?: 0)
    Plate(modifier.fillMaxWidth(), pad = 16) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Image(painterResource(Res.drawable.logo), null, Modifier.size(46.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Txt("${t("arena.level")} ${prog.level}", 18, FontWeight.ExtraBold, C.g50)
                    Chip(t("arena.rank.${Rules.rankForLevel(prog.level)}"), Tone.Neutral)
                }
                Bar(prog.ratio)
                Txt("${prog.into} / ${prog.span} ${t("app.xp")}", 12, FontWeight.Medium, C.g400)
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier = Modifier) {
    Plate(modifier, radius = 14, pad = 14) {
        Txt(value, 22, FontWeight.ExtraBold, C.g50, maxLines = 1)
        Spacer(Modifier.height(2.dp))
        Txt(label, 12, FontWeight.Medium, C.g400, maxLines = 1)
    }
}

@Composable
fun HomeScreen(model: AppModel) {
    val p = model.profile
    val size = Rules.DAILY_SET_SIZE
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        LevelHeader(model)

        if (model.offline) {
            Plate(Modifier.fillMaxWidth(), pad = 14) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Chip(t("arena.sync.offline"), Tone.Warn, Modifier.weight(1f, fill = false))
                    Box(Modifier.weight(1f))
                    KeyButton(t("arena.rankings.retry"), model::refresh)
                }
            }
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Stat(t("app.xp"), "${p?.xp ?: 0}", Modifier.weight(1f))
            Stat(t("arena.lobby.statStreak"), "${p?.streak ?: 0}", Modifier.weight(1f))
            Stat(t("arena.lobby.statDuels"), "${model.today?.votes ?: 0}", Modifier.weight(1f))
        }

        Plate(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Txt(t("arena.lobby.dailyTitle"), 18, FontWeight.ExtraBold, C.g50, Modifier.weight(1f))
                if (model.dailyComplete) Chip(t("arena.lobby.dailyDone"), Tone.Ok)
            }
            Spacer(Modifier.height(6.dp))
            Txt(t("arena.lobby.dailyBody", "size" to size), 14, color = C.g400)
            Spacer(Modifier.height(12.dp))
            Bar(model.dailyDone / size.toFloat())
            Spacer(Modifier.height(14.dp))
            if (!model.dailyComplete) {
                KeyButton(
                    if (model.dailyDone == 0) t("arena.lobby.dailyStart") else t("arena.lobby.dailyContinue", "done" to model.dailyDone, "size" to size),
                    model::startDaily, Modifier.fillMaxWidth(), lit = true, enabled = !model.loading, big = true,
                )
            }
        }

        Plate(Modifier.fillMaxWidth()) {
            Txt(t("arena.lobby.freeTitle"), 18, FontWeight.ExtraBold, C.g50)
            Spacer(Modifier.height(6.dp))
            Txt(t("arena.lobby.freeBody"), 14, color = C.g400)
            Spacer(Modifier.height(14.dp))
            KeyButton(t("arena.lobby.freeStart"), model::startFree, Modifier.fillMaxWidth(), lit = model.dailyComplete, enabled = !model.loading, big = true)
        }

        model.error?.let { Txt(it, 13, FontWeight.Medium, C.bad) }
        if (model.loading) Txt(t("common.loading"), 13, color = C.g500)
    }
}
