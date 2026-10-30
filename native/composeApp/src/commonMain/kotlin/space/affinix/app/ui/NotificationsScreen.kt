package space.affinix.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel
import space.affinix.app.store.Tab

@Composable
fun NotificationsScreen(model: AppModel) {
    val n = model.notifications
    LaunchedEffect(Unit) { n.refresh() }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IcoAction("arrowLeft", { model.tab = Tab.Play })
            Txt(t("shell.notifications.title"), 24, FontWeight.ExtraBold, C.g50, Modifier.weight(1f))
            if (n.unread > 0) KeyButton(t("app.markRead"), n::markAllRead, compact = true)
        }
        when {
            !n.loaded -> Txt(t("common.loading"), 14, color = C.g500)
            n.items.isEmpty() -> Plate(Modifier.fillMaxWidth()) { Txt(t("shell.notifications.empty"), 14, color = C.g400) }
            else -> Plate(Modifier.fillMaxWidth(), pad = 8) {
                n.items.forEach { it ->
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable(remember { MutableInteractionSource() }, null) { model.tab = if (it.type == "friend_request" || it.type == "friend_accept") Tab.People else Tab.Feed }
                            .padding(horizontal = 8.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Avatar(model, it.actor, 40.dp)
                        Column(Modifier.weight(1f)) {
                            Txt(t(n.copyKey(it.type), "name" to (it.actor.name ?: t("feed.unknownAuthor"))), 14, if (it.read) FontWeight.Normal else FontWeight.Bold, if (it.read) C.g300 else C.g50)
                            it.commentBody?.takeIf { b -> b.isNotBlank() }?.let { b -> Txt("«$b»", 13, color = C.g400, maxLines = 2) }
                            Txt(agoText(it.createdAt), 12, color = C.g500)
                        }
                        if (!it.read) Chip("•", Tone.Signal)
                    }
                }
            }
        }
    }
}
