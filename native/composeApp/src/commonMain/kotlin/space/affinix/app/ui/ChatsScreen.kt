package space.affinix.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.launch
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
import androidx.compose.foundation.layout.width
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
import space.affinix.app.net.Quote
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
    var query by remember { mutableStateOf("") }
    LaunchedEffect(query) { if (query.trim().length < 2) msg.clearSearch() else { delay(350); msg.searchText(query) } }
    val shown = remember(msg.conversations, query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) msg.conversations else msg.conversations.filter { (it.other.name ?: "").lowercase().contains(q) || (it.other.username ?: "").lowercase().contains(q) }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Txt(t("messages.title"), 24, FontWeight.ExtraBold, C.g50)
        msg.notice?.let { Chip(t(it), Tone.Info) }
        if (msg.loaded && msg.conversations.isNotEmpty()) Field(query, { query = it }, t("messages.search"))
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
                if (shown.isEmpty()) Txt(t("messages.noResults"), 14, color = C.g500, modifier = Modifier.padding(12.dp))
                shown.forEach { c ->
                    Row(
                        Modifier.fillMaxWidth().clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { msg.openChat(c) }.padding(horizontal = 8.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Avatar(model, c.other, 46.dp)
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Txt(c.other.name ?: t("feed.unknownAuthor"), 15, FontWeight.ExtraBold, C.g50, Modifier.weight(1f), maxLines = 1)
                                if (c.pinned) Ico("pin", color = C.g400, size = 14.dp)
                                if (c.muted) Ico("bellOff", color = C.g500, size = 14.dp)
                                c.lastAt?.let { Txt(agoText(it), 12, color = C.g500, maxLines = 1) }
                            }
                            val preview = when {
                                c.lastDeleted -> if (c.lastSender == model.api.session?.userId) t("messages.deletedMine") else t("messages.deletedTheirs")
                                c.lastHasImage && c.lastBody.isNullOrBlank() -> t("messages.photo")
                                else -> (if (c.lastSender == model.api.session?.userId) t("messages.you") + ": " else "") + (c.lastBody ?: "")
                            }
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Txt(preview, 13, if (c.unread > 0) FontWeight.Bold else FontWeight.Normal, if (c.unread > 0) C.g100 else C.g400, Modifier.weight(1f), maxLines = 1)
                                if (c.unread > 0) Chip("${c.unread}", if (c.muted) Tone.Neutral else Tone.Signal)
                            }
                        }
                    }
                }
            }
        }
        if (query.trim().length >= 2) {
            Txt(t("messages.searchMessagesTitle"), 13, FontWeight.Bold, C.g400)
            when {
                msg.searching -> Txt(t("messages.searching"), 13, color = C.g500)
                msg.found.isEmpty() -> Txt(t("messages.noResults"), 13, color = C.g500)
                else -> Plate(Modifier.fillMaxWidth(), pad = 8) {
                    msg.found.forEach { f ->
                        Column(
                            Modifier.fillMaxWidth().clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { query = ""; msg.openFound(f) }.padding(horizontal = 8.dp, vertical = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Txt(if (f.mine) t("messages.you") else f.other?.name ?: t("feed.unknownAuthor"), 13, FontWeight.ExtraBold, C.g50, Modifier.weight(1f), maxLines = 1)
                                Txt(agoText(f.createdAt), 12, color = C.g500, maxLines = 1)
                            }
                            Txt(f.body, 13, color = C.g300, maxLines = 2)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QuoteBar(model: AppModel, q: Quote, mine: Boolean) {
    val msg = model.messages
    val who = if (q.senderId == model.api.session?.userId) t("messages.you") else msg.open?.other?.name ?: t("feed.unknownAuthor")
    Row(Modifier.padding(bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.width(3.dp).height(30.dp).background(if (mine) C.signalInk.copy(alpha = .6f) else C.signalHi))
        Column {
            Txt(who, 12, FontWeight.ExtraBold, if (mine) C.signalInk else C.signalHi, maxLines = 1)
            Txt(
                when { q.deleted -> t("messages.deleted"); q.hasImage && q.text.isBlank() -> t("messages.photo"); else -> q.text },
                13, FontWeight.Medium, if (mine) C.signalInk.copy(alpha = .8f) else C.g300, maxLines = 2,
            )
        }
    }
}

/** The picture of a message: the bucket is private, so the link is signed first and the picture is then loaded like any other. */
@Composable
private fun AttachmentImage(model: AppModel, path: String) {
    var url by remember(path) { mutableStateOf<String?>(null) }
    LaunchedEffect(path) { url = model.messages.attachmentUrl(path); model.ensureUrlImage(url) }
    val bmp = url?.let { model.images[it] }
    val ratio = if (bmp != null && bmp.height > 0) bmp.width.toFloat() / bmp.height else 1.3f
    Box(Modifier.widthIn(max = 240.dp).fillMaxWidth().aspectRatio(ratio.coerceIn(.6f, 2f)).clip(RoundedCornerShape(10.dp)).background(C.g700).padding(bottom = 0.dp), contentAlignment = Alignment.Center) {
        if (bmp != null) Image(bmp, null, Modifier.matchParentSize(), contentScale = ContentScale.Crop)
        else Txt(t("common.loading"), 12, color = C.g500)
    }
    Spacer(Modifier.height(6.dp))
}

@Composable
private fun Bubble(model: AppModel, m: Message, selected: Boolean, onSelect: () -> Unit) {
    val mine = m.senderId == model.api.session?.userId
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start, modifier = Modifier.widthIn(max = 520.dp)) {
            val shape = 16.dp
            Column(
                (if (mine) Modifier.lit(shape) else Modifier.plate(shape))
                    .clickable(remember { MutableInteractionSource() }, null) { if (m.status == "failed") model.messages.retry(m) else onSelect() }
                    .padding(horizontal = 14.dp, vertical = 9.dp),
            ) {
                m.reply?.takeIf { !m.deleted }?.let { QuoteBar(model, it, mine) }
                if (m.reply == null && m.replyToId != null && !m.deleted) Txt(t("messages.quoteMissing"), 12, color = if (mine) C.signalInk.copy(alpha = .7f) else C.g500)
                if (m.attachmentPath != null && !m.deleted) AttachmentImage(model, m.attachmentPath)
                val text = when {
                    m.deleted -> if (mine) t("messages.deletedMine") else t("messages.deletedTheirs")
                    m.hasImage && m.body.isBlank() -> if (m.attachmentPath == null) t("messages.photo") else ""
                    else -> m.body
                }
                if (text.isNotEmpty()) Txt(text, 15, if (m.deleted) FontWeight.Normal else FontWeight.Medium, if (mine) C.signalInk else C.g100)
            }
            if (m.reactions.isNotEmpty()) {
                Row(Modifier.padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    m.reactions.groupBy { it.emoji }.forEach { (e, who) ->
                        val mineToo = who.any { it.userId == model.api.session?.userId }
                        Chip(if (who.size > 1) "$e ${who.size}" else e, if (mineToo) Tone.Signal else Tone.Neutral, Modifier.clickable(remember { MutableInteractionSource() }, null) { model.messages.react(m, e) })
                    }
                }
            }
            Row(Modifier.padding(horizontal = 4.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                Txt(clockText(m.createdAt) + if (m.edited && !m.deleted) " · ${t("messages.edited")}" else "", 11, color = C.g500)
                if (mine) when (m.status) {
                    "sending" -> Ico("clock", color = C.g500, size = 12.dp)
                    "failed" -> Txt(t("messages.failedRetry"), 11, FontWeight.Bold, C.bad)
                    else -> if (!m.deleted) Ico(if (m.read) "checks" else "check", color = if (m.read) C.info else C.g500, size = 13.dp)
                }
            }
            if (selected) ActionPanel(model, m)
        }
    }
}

/** What a tap on a message offers: the six reactions, reply, copy, and (my own) edit and delete. */
@Composable
private fun ActionPanel(model: AppModel, m: Message) {
    val msg = model.messages
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    var confirm by remember(m.id) { mutableStateOf(false) }
    val mine = m.senderId == model.api.session?.userId
    Plate(Modifier.padding(vertical = 4.dp), radius = 14, pad = 10) {
        if (!m.deleted && m.status == null) {
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                val mineEmoji = m.reactions.firstOrNull { it.userId == model.api.session?.userId }?.emoji
                MessagesModelReactions.forEach { e ->
                    Box(
                        Modifier.clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { msg.react(m, e) }.padding(horizontal = 6.dp, vertical = 4.dp),
                    ) { Txt(e, if (e == mineEmoji) 26 else 22) }
                }
            }
            Spacer(Modifier.height(6.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (!m.deleted && m.status == null) KeyButton(t("messages.reply"), { msg.replyTo = m; msg.editing = null }, compact = true)
            if (!m.deleted && m.body.isNotBlank()) KeyButton(t("messages.copy"), { clipboard.setText(androidx.compose.ui.text.AnnotatedString(m.body)) }, compact = true)
            if (mine && msg.canEdit(m)) KeyButton(t("messages.edit"), { msg.editing = m; msg.replyTo = null }, compact = true)
            if (mine && !m.deleted) KeyButton(t("feed.deleteComment"), { confirm = true }, compact = true)
        }
        if (confirm) {
            Spacer(Modifier.height(8.dp))
            Txt(t("messages.deleteConfirmTitle"), 14, FontWeight.Bold, C.g50)
            Txt(t("messages.deleteConfirmBody"), 12, color = C.g400)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                KeyButton(t("feed.deleteComment"), { msg.delete(m); confirm = false }, lit = true, compact = true)
                KeyButton(t("common.cancel"), { confirm = false }, compact = true)
            }
        }
    }
}

private val MessagesModelReactions get() = space.affinix.app.store.MessagesModel.REACTIONS

/** One chat, full screen: header, messages (newest at the bottom), composer. */
@Composable
fun ThreadScreen(model: AppModel) {
    val msg = model.messages
    val c = msg.open ?: return
    var draft by remember(c.id) { mutableStateOf("") }
    var selected by remember(c.id) { mutableStateOf<String?>(null) }
    var image by remember(c.id) { mutableStateOf<space.affinix.app.ShrunkImage?>(null) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    LaunchedEffect(msg.editing?.id) { msg.editing?.let { draft = it.body } }
    LaunchedEffect(c.id) { while (true) { delay(4_000); msg.poll() } }
    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp).padding(top = 8.dp, bottom = 8.dp)) {
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            IcoAction("arrowLeft", { msg.closeChat() })
            Avatar(model, c.other, 38.dp)
            Column(Modifier.weight(1f)) {
                Txt(c.other.name ?: t("feed.unknownAuthor"), 16, FontWeight.ExtraBold, C.g50, maxLines = 1)
                c.other.username?.let { Txt("@$it", 12, color = C.g500, maxLines = 1) }
            }
            IcoAction("pin", { msg.setPref(c, pinned = !c.pinned) }, active = c.pinned, filled = false)
            IcoAction("bellOff", { msg.setPref(c, muted = !c.muted) }, active = c.muted, filled = false)
        }
        msg.notice?.let { Chip(t(it), Tone.Info, Modifier.padding(bottom = 6.dp)) }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                !msg.threadLoaded -> Txt(t("common.loading"), 14, color = C.g500)
                msg.thread.isEmpty() -> Txt(t("messages.noMessagesYet"), 14, color = C.g500, align = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp))
                else -> LazyColumn(Modifier.fillMaxSize(), reverseLayout = true, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(msg.thread.asReversed(), key = { it.id }) { m -> Bubble(model, m, selected == m.id) { selected = if (selected == m.id) null else m.id } }
                    if (msg.hasOlder) item { Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) { KeyButton(t("feed.loadMore"), { msg.loadOlder() }, compact = true) } }
                }
            }
        }
        msg.replyTo?.let { r ->
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Ico("reply", color = C.signalHi, size = 18.dp)
                Column(Modifier.weight(1f)) {
                    Txt(t("messages.replyingTo", "name" to if (r.senderId == model.api.session?.userId) t("messages.you") else c.other.name.orEmpty()), 12, FontWeight.Bold, C.signalHi, maxLines = 1)
                    Txt(if (r.body.isBlank() && r.hasImage) t("messages.photo") else r.body, 13, color = C.g400, maxLines = 1)
                }
                IcoAction("close", { msg.replyTo = null })
            }
        }
        msg.editing?.let {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Ico("edit", color = C.signalHi, size = 18.dp)
                Txt(t("messages.editing"), 13, FontWeight.Bold, C.signalHi, Modifier.weight(1f))
                IcoAction("close", { msg.editing = null; draft = "" })
            }
        }
        image?.let { img -> Box(Modifier.padding(top = 8.dp)) { PickedPreview(img) { image = null } } }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (msg.editing == null) IcoAction("image", {
                scope.launch {
                    val (img, why) = space.affinix.app.ImageRules.chooseAndShrink(space.affinix.app.ImageRules.CHAT_SIDE, space.affinix.app.ImageRules.CHAT_BYTES)
                    if (img != null) image = img else if (why != null) msg.say(why)
                }
            }, active = image != null, filled = false)
            Box(Modifier.weight(1f)) { TextArea(draft, { draft = it }, if (image != null) t("messages.captionPlaceholder") else t("messages.placeholder"), minHeight = 44.dp) }
            val canSend = draft.isNotBlank() || image != null
            KeyButton(if (msg.editing != null) t("messages.save") else t("messages.send"), { if (canSend) { msg.send(draft, image); draft = ""; image = null; selected = null } }, lit = true, enabled = canSend)
        }
    }
}
