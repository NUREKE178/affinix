package space.affinix.app.ui

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import space.affinix.app.Platform
import space.affinix.app.epochOfIso
import space.affinix.app.i18n.t
import space.affinix.app.net.Message
import space.affinix.app.store.AppModel
import space.affinix.app.store.Tab

/** "14:05" in the player's own time. */
fun clockText(iso: String): String {
    val at = epochOfIso(iso) ?: return ""
    val m = ((at + Platform.tzOffsetMinutes() * 60_000L).floorDiv(60_000L)).mod(1440L)
    return "${(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}"
}

@Composable
fun ChatsListScreen(model: AppModel) {
    val msg = model.messages
    LaunchedEffect(Unit) { while (true) { msg.refresh(); delay(12_000) } }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Txt(t("messages.title"), 24, FontWeight.ExtraBold, C.g50)
        msg.notice?.let { Chip(t(it), Tone.Info) }
        when {
            msg.failed && !msg.loaded -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("friends.loadErrorTitle"), 16, FontWeight.Bold, C.g50); Spacer(Modifier.height(4.dp))
                Txt(t("friends.loadErrorBody"), 13, color = C.g400); Spacer(Modifier.height(12.dp))
                KeyButton(t("people.retry"), { msg.refresh() })
            }
            !msg.loaded -> Txt(t("common.loading"), 14, color = C.g500)
            msg.conversations.isEmpty() -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("messages.startChat"), 16, FontWeight.Bold, C.g50); Spacer(Modifier.height(4.dp))
                Txt(t("messages.noFriendsBody"), 13, color = C.g400); Spacer(Modifier.height(12.dp))
                KeyButton(t("messages.goToFriends"), { model.tab = Tab.People }, lit = true)
            }
            else -> Plate(Modifier.fillMaxWidth(), pad = 8) {
                msg.conversations.forEach { c ->
                    Row(
                        Modifier.fillMaxWidth().clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { msg.openChat(c) }.padding(horizontal = 8.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Avatar(model, c.other, 46.dp)
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Txt(c.other.name ?: t("feed.unknownAuthor"), 15, FontWeight.ExtraBold, C.g50, Modifier.weight(1f), maxLines = 1)
                                c.lastAt?.let { Txt(agoText(it), 12, color = C.g500, maxLines = 1) }
                            }
                            val preview = when {
                                c.lastDeleted -> if (c.lastSender == model.api.session?.userId) t("messages.deletedMine") else t("messages.deletedTheirs")
                                c.lastHasImage && c.lastBody.isNullOrBlank() -> t("messages.photo")
                                else -> (if (c.lastSender == model.api.session?.userId) t("messages.you") + ": " else "") + (c.lastBody ?: "")
                            }
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Txt(preview, 13, if (c.unread > 0) FontWeight.Bold else FontWeight.Normal, if (c.unread > 0) C.g100 else C.g400, Modifier.weight(1f), maxLines = 1)
                                if (c.unread > 0) Chip("${c.unread}", Tone.Signal)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Bubble(model: AppModel, m: Message) {
    val mine = m.senderId == model.api.session?.userId
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start, modifier = Modifier.widthIn(max = 520.dp)) {
            val shape = 16.dp
            Box(
                (if (mine) Modifier.lit(shape) else Modifier.plate(shape))
                    .then(if (m.status == "failed") Modifier.clickable(remember { MutableInteractionSource() }, null) { model.messages.retry(m) } else Modifier)
                    .padding(horizontal = 14.dp, vertical = 9.dp),
            ) {
                val text = when {
                    m.deleted -> if (mine) t("messages.deletedMine") else t("messages.deletedTheirs")
                    m.hasImage && m.body.isBlank() -> t("messages.photo")
                    else -> m.body
                }
                Txt(text, 15, if (m.deleted) FontWeight.Normal else FontWeight.Medium, if (mine) C.signalInk else C.g100)
            }
            Row(Modifier.padding(horizontal = 4.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                Txt(clockText(m.createdAt) + if (m.edited) " · ${t("messages.edited")}" else "", 11, color = C.g500)
                if (mine) when (m.status) {
                    "sending" -> Ico("clock", color = C.g500, size = 12.dp)
                    "failed" -> Txt(t("messages.failedRetry"), 11, FontWeight.Bold, C.bad)
                    else -> Ico(if (m.read) "checks" else "check", color = if (m.read) C.info else C.g500, size = 13.dp)
                }
            }
        }
    }
}

/** One chat, full screen: header, messages (newest at the bottom), composer. */
@Composable
fun ThreadScreen(model: AppModel) {
    val msg = model.messages
    val c = msg.open ?: return
    var draft by remember(c.id) { mutableStateOf("") }
    LaunchedEffect(c.id) { while (true) { delay(4_000); msg.poll() } }
    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp).padding(top = 8.dp, bottom = 8.dp)) {
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            IcoAction("arrowLeft", { msg.closeChat() })
            Avatar(model, c.other, 38.dp)
            Column(Modifier.weight(1f)) {
                Txt(c.other.name ?: t("feed.unknownAuthor"), 16, FontWeight.ExtraBold, C.g50, maxLines = 1)
                c.other.username?.let { Txt("@$it", 12, color = C.g500, maxLines = 1) }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                !msg.threadLoaded -> Txt(t("common.loading"), 14, color = C.g500)
                msg.thread.isEmpty() -> Txt(t("messages.noMessagesYet"), 14, color = C.g500, align = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp))
                else -> LazyColumn(Modifier.fillMaxSize(), reverseLayout = true, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(msg.thread.asReversed(), key = { it.id }) { Bubble(model, it) }
                    if (msg.hasOlder) item { Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) { KeyButton(t("feed.loadMore"), { msg.loadOlder() }, compact = true) } }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { TextArea(draft, { draft = it }, t("messages.placeholder"), minHeight = 44.dp) }
            KeyButton(t("messages.send"), { if (draft.isNotBlank()) { msg.send(draft); draft = "" } }, lit = true, enabled = draft.isNotBlank())
        }
    }
}
