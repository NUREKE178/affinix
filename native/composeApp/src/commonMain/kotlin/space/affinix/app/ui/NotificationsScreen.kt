package space.affinix.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import space.affinix.app.Platform
import space.affinix.app.localDay
import space.affinix.app.i18n.t
import space.affinix.app.net.Notice
import space.affinix.app.store.AppModel
import space.affinix.app.store.Tab

/** The bell: what happened, in the groups Today / Yesterday / This week / Earlier. A new entry is a raised plate (an old one lies flat); a friend request is answered right where it stands. */
@Composable
fun NotificationsScreen(model: AppModel) {
    val n = model.notifications
    LaunchedEffect(Unit) { n.refresh(); model.people.load() }
    // regrouped when the list changes or the day does; the clock is read here, not in the groups, so that the same list always gives the same groups
    val groups = remember(n.items, localDay()) { groupNotices(n.items, Platform.nowMillis(), Platform.tzOffsetMinutes()) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            IcoAction("arrowLeft", { model.tab = Tab.Play })
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Txt(t("shell.notifications.title"), 24, FontWeight.ExtraBold, C.g50)
                if (n.unread > 0) Txt(t("days.newCount", "n" to n.unread), 13, FontWeight.Medium, C.signalHi)
            }
            if (n.unread > 0) KeyButton(t("app.markRead"), n::markAllRead, compact = true)
        }
        when {
            !n.loaded -> SkeletonList(4)
            n.items.isEmpty() -> Plate(Modifier.fillMaxWidth()) { Txt(t("shell.notifications.empty"), 14, color = C.g400) }
            else -> groups.forEach { g ->
                Row(Modifier.fillMaxWidth().padding(start = 2.dp, top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Txt(t(g.bucket.key).uppercase(), 11, FontWeight.ExtraBold, C.g400, spacing = 1.2f)
                    if (g.fresh > 0) Txt(t("days.newCount", "n" to g.fresh), 11, FontWeight.Bold, C.signalHi)
                }
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    g.items.forEach { NoticeRow(model, it, g.bucket) }
                }
            }
        }
    }
}

@Composable
private fun NoticeRow(model: AppModel, note: Notice, bucket: Bucket) {
    val n = model.notifications
    val shape = RoundedCornerShape(16.dp)
    // the open request of this very person, if it is still waiting: it can be answered here
    val request = if (note.type == "friend_request") model.people.incoming.firstOrNull { f -> f.other.id == note.actor.id } else null
    Row(
        Modifier.fillMaxWidth().enter()
            .then(if (note.read) Modifier.background(C.g900, shape).border(1.dp, C.hair, shape) else Modifier.plate(16.dp))
            .clickable(remember { MutableInteractionSource() }, null) { model.tab = if (note.type == "friend_request" || note.type == "friend_accept") Tab.People else Tab.Feed }
            .padding(12.dp),
        verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(model, note.actor, 40.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Txt(t(n.copyKey(note.type), "name" to (note.actor.name ?: t("feed.unknownAuthor"))), 14, if (note.read) FontWeight.Normal else FontWeight.Bold, if (note.read) C.g300 else C.g50)
            note.commentBody?.takeIf { b -> b.isNotBlank() }?.let { b -> Txt("«$b»", 13, color = C.g400, maxLines = 2) }
            Txt(noticeTime(note.createdAt, bucket), 12, color = C.g500)
            if (request != null) Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                KeyButton(t("friends.accept"), { model.people.accept(request) }, lit = true, compact = true)
                KeyButton(t("friends.decline"), { model.people.remove(request) }, compact = true)
            }
        }
    }
}
