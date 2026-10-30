package space.affinix.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
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
                    Box(Modifier.weight(1f))
                    IcoAction("search", { model.tab = space.affinix.app.store.Tab.Search }, filled = false)
                    Box(contentAlignment = Alignment.TopEnd) {
                        IcoAction("bell", { model.tab = space.affinix.app.store.Tab.Notifications }, active = model.notifications.unread > 0, filled = false)
                        if (model.notifications.unread > 0) Box(Modifier.padding(top = 2.dp).background(C.signal, Pill).padding(horizontal = 5.dp)) { Txt("${model.notifications.unread}", 10, FontWeight.ExtraBold, C.signalInk) }
                    }
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
        ArenaTabs(model)
        LevelHeader(model)
        model.newerVersion?.let { v ->
            Plate(Modifier.fillMaxWidth(), pad = 14) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Txt(t("app.updateAvailable", "v" to v), 14, FontWeight.Bold, C.g100, Modifier.weight(1f))
                    KeyButton(t("app.updateGet"), { space.affinix.app.Browser.openUrl(space.affinix.app.Versions.DOWNLOAD_PAGE) }, lit = true, compact = true)
                }
            }
        }

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

        MarathonPlate(model)

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

/** Play / Quests / Rankings: the three parts of the Arena, one tab in the bottom bar. */
@Composable
fun ArenaTabs(model: AppModel) {
    val parts = listOf(space.affinix.app.store.Tab.Play, space.affinix.app.store.Tab.Quests, space.affinix.app.store.Tab.Rankings)
    Segmented(listOf(t("arena.tabs.play"), t("arena.tabs.quests"), t("arena.tabs.rankings")), parts.indexOf(model.tab).coerceAtLeast(0), { model.tab = parts[it] })
}


/** Stage 3 of the Daily Challenge: the theme of the week, the five extra sets of the day and this week's race among friends. */
@Composable
private fun MarathonPlate(model: AppModel) {
    LaunchedEffect(model.dailyComplete, model.marathonReady) { if (model.dailyComplete && model.marathonReady) model.loadRace() }
    var claimNote by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    Plate(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Ico("trophy", color = C.signalHi, size = 20.dp)
            Txt(t("arena.marathon.stage3"), 18, FontWeight.ExtraBold, C.g50, Modifier.weight(1f))
        }
        Spacer(Modifier.height(6.dp))
        when {
            !model.dailyComplete -> Txt(t("arena.marathon.locked"), 14, color = C.g400)
            !model.marathonReady -> Txt(t("arena.marathon.oldDb"), 14, color = C.g400)
            else -> {
                Txt(t("arena.marathon.intro"), 13, color = C.g400)
                Spacer(Modifier.height(12.dp))
                val th = model.theme
                Well(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Txt(t("arena.marathon.themeTitle"), 12, FontWeight.Bold, C.g400)
                        Txt(t("arena.family.${th.family}"), 20, FontWeight.ExtraBold, C.g50)
                        Txt(t("arena.marathon.themeBody", "goal" to th.goal), 13, color = C.g400)
                        Bar(th.votes / th.goal.toFloat())
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Txt("${th.votes} / ${th.goal}", 13, FontWeight.Bold, C.g200, Modifier.weight(1f))
                            when {
                                th.claimed -> Chip(t("arena.marathon.themeDone"), Tone.Ok)
                                th.done -> KeyButton(t("arena.marathon.claim", "xp" to th.bonus), { scope.launch { claimNote = model.claim(Rules.THEME_QUEST) } }, lit = true, compact = true)
                                else -> Txt("+${th.bonus} ${t("app.xp")}", 13, FontWeight.Bold, C.signalHi)
                            }
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row {
                    Txt(t("arena.marathon.setsTitle"), 13, FontWeight.ExtraBold, C.g400, Modifier.weight(1f), spacing = .4f)
                    Txt(t("arena.marathon.setsHint"), 12, color = C.g500)
                }
                model.sets.forEach { e ->
                    val open = model.setOpen(e.n)
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Txt("${e.n}", 18, FontWeight.ExtraBold, if (open) C.signalHi else C.g600, Modifier.width(22.dp))
                        Column(Modifier.weight(1f)) {
                            Txt(t("arena.marathon.setN", "n" to e.n), 15, FontWeight.Bold, C.g50)
                            Txt("${e.votes} / ${e.size}", 12, color = C.g500)
                        }
                        when {
                            e.claimed -> Chip(t("arena.marathon.setDone"), Tone.Ok)
                            e.done -> KeyButton(t("arena.marathon.claim", "xp" to e.bonus), { scope.launch { claimNote = model.claim(Rules.setQuestId(e.n)) } }, lit = true, compact = true)
                            open -> KeyButton(if (e.votes > 0) t("arena.marathon.setContinue") else t("arena.marathon.setPlay", "xp" to e.bonus), { model.startSet(e.n) }, lit = e.votes > 0, compact = true, enabled = !model.loading)
                            else -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Ico("lock", color = C.g600, size = 14.dp); Txt(t("arena.marathon.setLocked", "n" to e.n - 1), 12, color = C.g600)
                            }
                        }
                    }
                }
                claimNote?.let { Txt(t(it), 12, FontWeight.Medium, C.bad) }
                Spacer(Modifier.height(10.dp))
                FriendsRace(model)
            }
        }
    }
}

@Composable
private fun FriendsRace(model: AppModel) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Ico("friends", color = C.g400, size = 16.dp)
        Txt(t("arena.marathon.raceTitle"), 13, FontWeight.ExtraBold, C.g400, Modifier.weight(1f), spacing = .4f)
        LinkText(t("arena.lobby.boardAll"), { model.tab = space.affinix.app.store.Tab.Rankings })
    }
    val rows = model.race?.rows.orEmpty()
    val mine = rows.firstOrNull { it.isMe }
    when {
        model.race == null && !model.raceFailed -> Txt(t("common.loading"), 13, color = C.g500)
        rows.size < 2 -> {
            Txt(t("arena.marathon.raceNone"), 13, color = C.g400)
            Spacer(Modifier.height(8.dp))
            KeyButton(t("arena.marathon.raceFind"), { model.tab = space.affinix.app.store.Tab.People }, compact = true)
        }
        else -> {
            val leader = rows.first()
            if (mine != null) Txt(if (mine.rank == 1) t("arena.marathon.raceLead") else t("arena.marathon.raceGap", "n" to (leader.xp - mine.xp), "name" to leader.name.ifBlank { t("feed.unknownAuthor") }), 13, color = C.g300)
            val list = rows.take(5).toMutableList().also { l -> if (mine != null && mine !in l) l += mine }
            list.forEach { r ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Txt("${r.rank}", 14, FontWeight.ExtraBold, C.g500, Modifier.width(22.dp))
                    Txt(r.name.ifBlank { t("feed.unknownAuthor") } + if (r.isMe) " · ${t("arena.rankings.you")}" else "", 14, if (r.isMe) FontWeight.ExtraBold else FontWeight.Medium, if (r.isMe) C.signalHi else C.g100, Modifier.weight(1f), maxLines = 1)
                    Txt("${r.xp} ${t("app.xp")}", 13, FontWeight.Bold, C.g300)
                }
            }
        }
    }
}
