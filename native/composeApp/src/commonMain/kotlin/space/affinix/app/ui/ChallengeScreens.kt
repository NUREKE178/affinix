package space.affinix.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import space.affinix.app.Browser
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel
import space.affinix.app.store.Challenge
import space.affinix.app.store.Round

// Taste Match on the native screens, drawn from the canvas «Affinix: First Look and Taste Match» (the phone boards) and from the website's
// pages/arena/Challenge.js: the one-screen welcome (own, or from a friend's link), the share card after a round, and the match after a friend's challenge.

/** the site's address, where a link of this kind opens in a browser (and on a phone with the app, the app can be offered it) */
private const val SITE = "https://affinix.space"

private fun Modifier.dashed(color: Color, radius: Dp = 7.dp): Modifier = this.drawBehind {
    drawRoundRect(color, cornerRadius = CornerRadius(radius.toPx()), style = Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 5f))))
}

private fun initialOf(name: String) = name.firstOrNull()?.uppercaseChar()?.toString() ?: "?"

@Composable
private fun HiddenDots(n: Int) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(n) {
            Box(Modifier.weight(1f).height(24.dp).background(Color.Black.copy(alpha = .4f), RoundedCornerShape(7.dp)).dashed(C.g500), contentAlignment = Alignment.Center) { Txt("?", 11, FontWeight.Bold, C.g400) }
        }
    }
}

/** The first thing a new player sees in the Arena: no questions, one key. [model].activeChallenge is a friend's waiting link (or null). */
@Composable
fun FirstLook(model: AppModel) {
    val ch = model.activeChallenge
    val from = ch?.let { it.name ?: t("arena.challenge.someone") }
    val mine = Challenge.cleanName(model.myProfile?.fullName)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Plate(Modifier.fillMaxWidth(), radius = 22, pad = 24) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (from != null) {
                    Box(Modifier.size(56.dp).clip(CircleShape).background(C.signal), contentAlignment = Alignment.Center) { Txt(initialOf(from), 26, FontWeight.ExtraBold, C.signalInk) }
                } else {
                    Box(Modifier.size(56.dp).clip(RoundedCornerShape(17.dp)).background(Color.Black.copy(alpha = .4f)).border(1.dp, C.hair, RoundedCornerShape(17.dp)), contentAlignment = Alignment.Center) { Ico("sparkle", color = C.signalHi, size = 26.dp) }
                }
                Txt(
                    when { from != null -> t("arena.challenge.title", "name" to from); mine.isNotEmpty() -> t("arena.firstLook.title", "name" to mine); else -> t("arena.firstLook.titleNoName") },
                    25, FontWeight.ExtraBold, C.g50, align = TextAlign.Center,
                )
                Txt(if (from != null) t("arena.challenge.body") else t("arena.firstLook.body"), 15, color = C.g400, align = TextAlign.Center)
                if (ch != null) {
                    HiddenDots(ch.answers.size)
                    Txt(t("arena.challenge.hidden"), 12, color = C.g400)
                    if (!Challenge.seasonIsLive(ch.season, space.affinix.app.Platform.nowMillis())) Txt(t("arena.challenge.oldSeason"), 12, color = C.g300, align = TextAlign.Center)
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Txt(t("arena.firstLook.fact1"), 13, color = C.g300); Box(Modifier.size(3.dp).background(C.g500, CircleShape))
                        Txt(t("arena.firstLook.fact2"), 13, color = C.g300); Box(Modifier.size(3.dp).background(C.g500, CircleShape))
                        Txt(t("arena.firstLook.fact3"), 13, color = C.g300)
                    }
                }
                KeyButton(
                    if (ch != null) t("arena.challenge.play") else t("arena.firstLook.start"),
                    { if (ch != null) model.playChallenge() else model.startFirstRound() },
                    Modifier.fillMaxWidth(), lit = true, big = true, enabled = !model.loading,
                )
                LinkText(
                    if (ch != null) t("arena.challenge.later") else t("arena.firstLook.later"),
                    { model.markFirstLookSeen(); if (ch != null) model.snoozeChallenge() },
                )
            }
        }
        Txt(if (ch != null) t("arena.challenge.keep") else t("arena.firstLook.note"), 12, color = C.g400, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        if (ch == null) PasteChallengeLink(model)
    }
}

/** A quiet link for a person who has been sent a challenge but opened the app by hand: it reads the clipboard once, when asked. */
@Composable
fun PasteChallengeLink(model: AppModel) {
    val clipboard = LocalClipboardManager.current
    var bad by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        LinkText(t("arena.challenge.pasteLink"), { bad = !model.receiveChallenge(clipboard.getText()?.text) })
        if (bad) Txt(t("arena.challenge.pasteBad"), 12, FontWeight.Medium, C.bad, align = TextAlign.Center)
    }
}

/** "Challenge a friend": the answers of the round that was just played, as the website's link. [own]: after a friend's challenge (the same pairs, with this player's answers, for somebody else). */
@Composable
fun ChallengeShareCard(model: AppModel, r: Round, own: Boolean) {
    LaunchedEffect(Unit) { if (model.myProfile == null) model.loadMyProfile() }
    val season = r.duels.firstOrNull()?.season ?: return
    val answers = Challenge.answersOf(season, r.results).second
    if (answers.isEmpty()) return
    val c = Challenge.encode(season, answers, model.myProfile?.fullName) ?: return
    val url = "$SITE/?c=$c"
    val n = answers.size
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    val shareText = t("arena.challenge.shareText", "n" to n) + "\n" + url
    Plate(Modifier.fillMaxWidth(), radius = 20, pad = 18) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(36.dp).clip(RoundedCornerShape(11.dp)).background(Color.Black.copy(alpha = .4f)).border(1.dp, C.hair, RoundedCornerShape(11.dp)), contentAlignment = Alignment.Center) { Ico("send", color = C.signalHi, size = 18.dp) }
                Txt(if (own) t("arena.match.sendOwn") else t("arena.challenge.shareTitle"), 18, FontWeight.ExtraBold, C.g50, Modifier.weight(1f))
            }
            Txt(if (own) t("arena.match.sendOwnBody", "n" to n) else t("arena.challenge.shareBody", "n" to n), 14, color = C.g400)
            Row(
                Modifier.fillMaxWidth().background(Color.Black.copy(alpha = .4f), RoundedCornerShape(12.dp)).border(1.dp, C.hair, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Txt(url, 13, color = C.g300, modifier = Modifier.weight(1f), maxLines = 1)
                LinkText(if (copied) t("arena.challenge.copied") else t("arena.challenge.copy"), { clipboard.setText(AnnotatedString(url)); copied = true }, color = C.signalHi)
            }
            KeyButton(
                t("arena.challenge.shareCta"),
                { if (!Browser.shareText(shareText)) { clipboard.setText(AnnotatedString(shareText)); copied = true } },
                Modifier.fillMaxWidth(), lit = true,
            )
            Txt(t("arena.challenge.privacy", "n" to n), 12, color = C.g400)
        }
    }
}

/** The result of a friend's challenge: the percentage, one segment per pair, and the pairs where the two people split. */
@Composable
fun MatchBlock(model: AppModel, r: Round) {
    val ch = r.challenge ?: return
    val season = r.duels.firstOrNull()?.season ?: return
    val m = remember(r) { Challenge.matchOf(season, ch.answers, r.results) }
    val them = ch.name ?: t("arena.challenge.someone")
    val me = Challenge.cleanName(model.myProfile?.fullName).ifEmpty { t("arena.match.you") }
    val band = Challenge.label(m.percent)
    Plate(Modifier.fillMaxWidth(), radius = 22, pad = 20) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(t("arena.match.vs", "a" to me, "b" to them).uppercase(), 13, FontWeight.Bold, C.g400, spacing = 1f)
            if (m.percent == null) Txt("–", 72, FontWeight.ExtraBold, C.signalHi)
            else {
                CountText(m.percent, 84, FontWeight.ExtraBold, C.signalHi, suffix = "%")
                Txt(t("arena.match.label"), 17, FontWeight.Bold, C.g50)
                Txt(t("arena.match.line", "same" to m.same, "total" to m.compared) + " " + t("arena.match.$band"), 13, color = C.g400, align = TextAlign.Center)
            }
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                m.sameAt.forEachIndexed { i, eq ->
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        val seg = Modifier.fillMaxWidth().height(10.dp)
                        when (eq) {
                            true -> Box(seg.background(C.signal, RoundedCornerShape(5.dp)))
                            false -> Box(seg.border(1.dp, C.g400, RoundedCornerShape(5.dp)))
                            null -> Box(seg.dashed(C.g500, 5.dp))
                        }
                        Txt("${i + 1}", 10, color = C.g400)
                    }
                }
            }
            Spacer(Modifier.height(4.dp))
            Txt(t("arena.match.splits").uppercase(), 12, FontWeight.Bold, C.g400, Modifier.fillMaxWidth(), spacing = 1f)
            val shown = m.splits.take(4)
            if (shown.isEmpty()) Txt(t("arena.match.noSplits"), 13, color = C.g400, modifier = Modifier.fillMaxWidth())
            else {
                shown.forEach { i ->
                    val a = ch.answers[i]
                    val mine = r.results.firstOrNull { it.duel.pair == Challenge.pairOf(season, a) && it.duel.dim == a.dim }?.pick
                    Row(
                        Modifier.fillMaxWidth().background(Color.Black.copy(alpha = .25f), RoundedCornerShape(14.dp)).border(1.dp, C.hair, RoundedCornerShape(14.dp)).padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 16.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Txt("${i + 1}", 13, FontWeight.Bold, C.g400, Modifier.width(22.dp))
                        listOf(0 to a.a, 1 to a.b).forEach { (side, index) ->
                            val isMine = mine == side
                            val isTheirs = a.pick == side
                            Box(Modifier.size(60.dp)) {
                                Box(
                                    Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = .05f))
                                        .border(2.dp, if (isMine) C.signalHi else if (isTheirs) C.g300 else Color.Transparent, RoundedCornerShape(12.dp)),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    val bmp = model.images["$season/${a.family}/$index"]
                                    if (bmp != null) androidx.compose.foundation.Image(bmp, null, Modifier.fillMaxWidth().padding(3.dp), contentScale = androidx.compose.ui.layout.ContentScale.Fit)
                                }
                                if (isMine || isTheirs) {
                                    Box(Modifier.align(Alignment.BottomStart).background(if (isMine) C.signalHi else C.g300, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 1.dp)) {
                                        Txt(if (isMine) t("arena.match.you") else initialOf(them), 10, FontWeight.ExtraBold, C.canvas)
                                    }
                                }
                            }
                        }
                    }
                }
                if (m.splits.size > shown.size) Txt(t("arena.match.more", "n" to (m.splits.size - shown.size)), 13, color = C.g400, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}
