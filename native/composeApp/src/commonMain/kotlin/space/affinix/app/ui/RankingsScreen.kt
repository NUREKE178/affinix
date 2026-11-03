package space.affinix.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel

@Composable
fun RankingsScreen(model: AppModel) {
    LaunchedEffect(Unit) { model.loadLeaderboard() }
    val lb = model.leaderboard
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        ArenaTabs(model)
        Segmented(
            listOf(t("arena.rankings.week"), t("arena.rankings.all")),
            if (model.leaderboardScope == "week") 0 else 1,
            { model.loadLeaderboard(if (it == 0) "week" else "all") },
        )
        when {
            model.leaderboardFailed && lb == null -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("arena.rankings.offlineTitle"), 16, FontWeight.Bold, C.g50)
                Spacer(Modifier.height(4.dp))
                Txt(t("arena.rankings.offlineBody"), 13, color = C.g400)
                Spacer(Modifier.height(12.dp))
                KeyButton(t("arena.rankings.retry"), { model.loadLeaderboard() })
            }
            lb == null -> SkeletonList(6)
            lb.rows.isEmpty() -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("arena.rankings.emptyTitle"), 16, FontWeight.Bold, C.g50)
                Spacer(Modifier.height(4.dp))
                Txt(t("arena.rankings.emptyBody"), 13, color = C.g400)
            }
            else -> {
                val all = model.leaderboardScope == "all"
                Podium(model, lb.rows.take(3), all)
                // the first three stand on the podium; the others (and nobody else) are in the list below it
                val rest = if (lb.rows.size > 3) lb.rows.drop(3) else emptyList()
                if (rest.isNotEmpty()) Plate(Modifier.fillMaxWidth(), pad = 8) {
                    rest.forEach { row ->
                        val who = row.person(); val info = row.arenaInfo(all)
                        Row(
                            Modifier.fillMaxWidth().then(if (row.isMe) Modifier.well(12.dp) else Modifier).personTap(model, who, info).padding(horizontal = 10.dp, vertical = 9.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Txt("${row.rank}", 15, FontWeight.ExtraBold, C.g400, Modifier.width(28.dp), align = TextAlign.Center)
                            Avatar(model, who, 36.dp, opens = false)
                            Column(Modifier.weight(1f)) {
                                Txt(if (row.isMe) "${row.name.ifBlank { "–" }} · ${t("arena.rankings.you")}" else row.name.ifBlank { "–" }, 15, FontWeight.Bold, C.g50, maxLines = 1)
                                Txt("${t("arena.level")} ${row.level}", 12, color = C.g500)
                            }
                            Txt("${row.xp} ${t("app.xp")}", 14, FontWeight.ExtraBold, C.g100, maxLines = 1)
                        }
                    }
                }
            }
        }
        val me = lb?.me
        if (me?.rank != null && lb.rows.none { it.isMe }) {
            Box(Modifier.fillMaxWidth()) { Chip("${t("arena.rankings.you")}: #${me.rank} · ${me.xp} ${t("app.xp")}", Tone.Signal) }
        }
    }
}
