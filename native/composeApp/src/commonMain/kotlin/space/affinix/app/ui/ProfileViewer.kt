package space.affinix.app.ui

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerIcon
import androidx.compose.ui.input.pointer.pointerHoverIcon
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import space.affinix.app.i18n.t
import space.affinix.app.net.LeaderRow
import space.affinix.app.net.Person
import space.affinix.app.store.AppModel
import space.affinix.app.store.ArenaInfo
import space.affinix.app.store.Tab

/** What a rankings row says about a person's place in the Arena, for the strip of the profile card. */
fun LeaderRow.arenaInfo(allTime: Boolean) = ArenaInfo(rank.takeIf { it > 0 }, level, xp, streak, allTime)

/** A leaderboard row as a person (the lookup in the profile card fills in the rest). */
fun LeaderRow.person() = Person(userId, name.ifBlank { null }, username, avatarUrl)

/** Put on anything that shows a person (a picture, a name): a tap opens that person's profile card; the desktop cursor turns into a hand. */
fun Modifier.personTap(model: AppModel, who: Person, arena: ArenaInfo? = null): Modifier = composed {
    val label = t("people.openProfile", "name" to (who.name ?: t("feed.unknownAuthor")))
    pointerHoverIcon(PointerIcon.Hand).clickable(remember { MutableInteractionSource() }, null, role = Role.Button, onClickLabel = label) { model.profileViewer.open(who, arena) }
}

/** What the card shows, kept after it is closed so that it can fade out with its content instead of going blank first. */
private class Held(val person: Person, val arena: ArenaInfo?, val detailsDone: Boolean, val friends: Int?, val isSelf: Boolean)

/**
 * The profile card, mounted once over the whole shell: a dim scrim and a card that rises and settles (and sinks away again). A tap beside the card, the close key, Esc on
 * the desktop and Back on the phone all close it. The model behind it: [space.affinix.app.store.ProfileViewerModel].
 */
@Composable
fun ProfileViewerHost(model: AppModel) {
    val pv = model.profileViewer
    val open = pv.isOpen
    val target = if (open) 1f else 0f
    val animated by animateFloatAsState(target, tween(240, easing = FastOutSlowInEasing), label = "profileCard")
    val p = if (Motion.enabled) animated else target
    val held = remember { arrayOfNulls<Held>(1) }
    pv.person?.let { held[0] = Held(it, pv.arena, pv.detailsDone, pv.friendsCount, pv.isSelf) }
    val view = held[0] ?: return
    if (p <= 0f && !open) return
    val scroll = rememberScrollState()
    val cardPull = rememberPull()
    var pull by androidx.compose.runtime.remember { androidx.compose.runtime.mutableFloatStateOf(0f) } // how far the card is dragged down (0 .. 1): the dim behind it lifts with it
    Box(
        Modifier.fillMaxSize().graphicsLayer { alpha = p * (1f - .7f * pull) }.background(C.canvas.copy(alpha = .8f))
            .clickable(remember { MutableInteractionSource() }, null) { pv.close() },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 400.dp).fillMaxWidth().padding(20.dp).pullOffset(cardPull).verticalScroll(scroll).pullToDismiss(cardPull, scroll, { pull = it }) { pv.close() }
                .graphicsLayer { translationY = (1f - p) * 36.dp.toPx(); val s = .94f + .06f * p; scaleX = s; scaleY = s }
                .plate(20.dp).clip(RoundedCornerShape(20.dp))
                .clickable(remember { MutableInteractionSource() }, null) { /* a tap on the card itself must not reach the scrim */ }
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            ProfileCardContent(model, view)
        }
    }
}

@Composable
private fun ProfileCardContent(model: AppModel, v: Held) {
    val pv = model.profileViewer
    val p = v.person
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Avatar(model, p, 68.dp, opens = false)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Txt(p.name ?: t("feed.unknownAuthor"), 21, FontWeight.ExtraBold, C.g50, maxLines = 2)
            p.username?.let { Txt("@$it", 14, FontWeight.Medium, C.signalHi, maxLines = 1) }
            p.roleTitle?.takeIf { it.isNotBlank() }?.let { Txt(it, 13, color = C.g400, maxLines = 2) }
        }
        IcoAction("close", { pv.close() })
    }

    v.arena?.let { a ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Stat(t("people.profile.place"), a.rank?.let { "#$it" } ?: "—", Modifier.weight(1f))
            Stat(t("arena.level"), "${a.level}", Modifier.weight(1f))
            Stat(t(if (a.allTime) "people.profile.xpAll" else "people.profile.xpWeek"), grouped(a.xp.toInt()), Modifier.weight(1f))
        }
    }

    val streak = v.arena?.streak ?: 0
    if (streak > 0 || v.friends != null) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (streak > 0) Chip("$streak ${t(if (streak == 1) "arena.quests.dayOne" else "arena.quests.days")}", Tone.Signal)
            v.friends?.let { Chip(t("friends.countLabel", "count" to it), Tone.Neutral) }
        }
    }

    when {
        p.bio.isNullOrBlank() && !v.detailsDone -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { SkeletonBar(1f); SkeletonBar(.62f) }
        p.bio.isNullOrBlank() -> Txt(t("feed.noBio"), 14, color = C.g500)
        else -> Txt(p.bio, 14, color = C.g200)
    }

    Box(Modifier.fillMaxWidth().height(1.dp).background(C.hair))
    if (v.isSelf) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Chip(t("people.profile.you"), Tone.Signal)
            KeyButton(t("people.profile.openMine"), { pv.close(); model.tab = Tab.Profile }, compact = true)
        }
    } else if (p.id.isNotBlank()) {
        ProfileActions(model, p)
    }
}

/** The friend key and (once friends) the message key. Waits for the friendships to be known so that it never offers «Add friend» to someone who already is one. */
@Composable
private fun ProfileActions(model: AppModel, p: Person) {
    val ppl = model.people
    LaunchedEffect(Unit) { if (!ppl.loaded) ppl.load() }
    when {
        !ppl.loaded && ppl.failed -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Txt(t("friends.loadErrorTitle"), 13, color = C.g400, modifier = Modifier.weight(1f))
            KeyButton(t("common.retry"), { ppl.load() }, compact = true)
        }
        !ppl.loaded -> LoadingState(compact = true)
        else -> Relation(model, p, after = { model.profileViewer.close() })
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier.well(12.dp).padding(vertical = 10.dp, horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Txt(value, 19, FontWeight.ExtraBold, C.g50, maxLines = 1)
        Txt(label, 11, FontWeight.Medium, C.g500, align = TextAlign.Center, maxLines = 1)
    }
}

/** a grey bar that breathes while the real text is on its way */
@Composable
private fun SkeletonBar(fraction: Float) {
    val a = if (Motion.enabled) {
        val v by rememberInfiniteTransition(label = "skeleton").animateFloat(.35f, .8f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "alpha")
        v
    } else .6f
    Spacer(Modifier.fillMaxWidth(fraction).height(12.dp).graphicsLayer { alpha = a }.clip(RoundedCornerShape(6.dp)).background(C.g700))
}
