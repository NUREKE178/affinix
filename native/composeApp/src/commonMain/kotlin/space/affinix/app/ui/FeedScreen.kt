package space.affinix.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import org.jetbrains.compose.resources.decodeToImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import space.affinix.app.Platform
import space.affinix.app.epochOfIso
import space.affinix.app.i18n.t
import space.affinix.app.net.Comment
import space.affinix.app.net.Person
import space.affinix.app.net.Post
import space.affinix.app.store.AppModel

/** "5 min ago", "3 d ago", or the date for anything older than a week. */
@Composable
fun agoText(iso: String): String {
    val at = epochOfIso(iso) ?: return ""
    val sec = ((Platform.nowMillis() - at) / 1000).coerceAtLeast(0)
    return when {
        sec < 60 -> t("app.ago.now")
        sec < 3600 -> t("app.ago.min", "n" to sec / 60)
        sec < 86400 -> t("app.ago.hour", "n" to sec / 3600)
        sec < 7 * 86400 -> t("app.ago.day", "n" to sec / 86400)
        else -> iso.take(10)
    }
}

/** A round picture of a person, or their first letter on graphite while it loads (or when they have none). */
@Composable
fun Avatar(model: AppModel, person: Person, size: Dp = 40.dp) {
    val url = person.avatarUrl
    LaunchedEffect(url) { model.ensureUrlImage(url) }
    val bmp = url?.let { model.images[it] }
    Box(Modifier.size(size).clip(CircleShape).background(C.g700), contentAlignment = Alignment.Center) {
        if (bmp != null) Image(bmp, null, Modifier.size(size), contentScale = ContentScale.Crop)
        else Txt((person.name ?: person.username ?: "?").trim().take(1).uppercase(), (size.value * .42f).toInt(), FontWeight.ExtraBold, C.g200)
    }
}

@Composable
internal fun TextArea(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, minHeight: Dp = 84.dp) {
    Box(modifier.fillMaxWidth().well(12.dp).padding(horizontal = 14.dp, vertical = 12.dp).heightIn(min = minHeight)) {
        if (value.isEmpty()) Txt(placeholder, 15, color = C.g600)
        BasicTextField(value, onChange, textStyle = ts(15, FontWeight.Medium, C.g50, LocalFonts.current.family), cursorBrush = SolidColor(C.signal), modifier = Modifier.fillMaxWidth())
    }
}

/** The picture chosen for a post or message, small, with a way to take it off. */
@OptIn(org.jetbrains.compose.resources.ExperimentalResourceApi::class)
@Composable
internal fun PickedPreview(img: space.affinix.app.ShrunkImage, onRemove: () -> Unit) {
    val bmp = remember(img) { runCatching { img.bytes.decodeToImageBitmap() }.getOrNull() }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(72.dp).clip(RoundedCornerShape(10.dp)).background(C.g700)) {
            if (bmp != null) Image(bmp, null, Modifier.size(72.dp), contentScale = ContentScale.Crop)
        }
        Txt(t("messages.removeImage"), 13, FontWeight.Medium, C.g400, Modifier.weight(1f))
        IcoAction("close", onRemove)
    }
}

@Composable
private fun Composer(model: AppModel) {
    val feed = model.feed
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var image by remember { mutableStateOf<space.affinix.app.ShrunkImage?>(null) }
    val scope = rememberCoroutineScope()
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        TextArea(text, { text = it; error = null }, t("feed.composerPlaceholder"))
        image?.let { img ->
            Spacer(Modifier.height(10.dp))
            PickedPreview(img) { image = null }
        }
        error?.let { Spacer(Modifier.height(8.dp)); Txt(t(it), 13, FontWeight.Medium, C.bad) }
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            IcoAction("image", {
                scope.launch {
                    val (img, why) = space.affinix.app.ImageRules.chooseAndShrink(space.affinix.app.ImageRules.POST_SIDE, space.affinix.app.ImageRules.POST_BYTES)
                    if (img != null) { image = img; error = null } else if (why != null) error = why
                }
            }, active = image != null, filled = false)
            KeyButton(if (busy) t("feed.posting") else t("feed.publish"), {
                if (!busy && text.isNotBlank()) {
                    busy = true
                    scope.launch { val e = feed.publish(text, image); if (e == null) { text = ""; image = null } else error = e; busy = false }
                }
            }, lit = true, enabled = !busy && text.isNotBlank())
        }
    }
}

@Composable
private fun CommentRowView(model: AppModel, c: Comment, mine: Boolean) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Avatar(model, c.author, 30.dp)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Txt(c.author.name ?: t("feed.unknownAuthor"), 13, FontWeight.Bold, C.g100, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                Txt(agoText(c.createdAt), 12, color = C.g500, maxLines = 1)
            }
            Txt(c.body, 14, color = C.g200)
        }
        if (mine) IcoAction("trash", { model.feed.deleteComment(c) })
    }
}

@Composable
private fun PostCard(model: AppModel, p: Post) {
    val feed = model.feed
    val mine = p.author.id == model.api.session?.userId
    val open = p.id in feed.openComments
    LaunchedEffect(p.imageUrl) { model.ensureUrlImage(p.imageUrl) }
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Avatar(model, p.author)
            Column(Modifier.weight(1f)) {
                Txt(p.author.name ?: t("feed.unknownAuthor"), 15, FontWeight.ExtraBold, C.g50, maxLines = 1)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    p.author.username?.let { Txt("@$it", 12, color = C.g500, maxLines = 1, modifier = Modifier.weight(1f, fill = false)) }
                    Txt(agoText(p.createdAt) + if (p.edited) " · ${t("feed.edited")}" else "", 12, color = C.g500, maxLines = 1)
                }
            }
            if (mine) IcoAction("trash", { feed.delete(p) })
        }
        Spacer(Modifier.height(10.dp))
        Txt(p.body, 15, color = C.g100)
        p.imageUrl?.let { u ->
            val bmp = model.images[u]
            Spacer(Modifier.height(10.dp))
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(C.wellTop), contentAlignment = Alignment.Center) {
                if (bmp != null) Image(bmp, null, Modifier.fillMaxWidth().aspectRatio(bmp.width.toFloat() / bmp.height.toFloat()), contentScale = ContentScale.Fit)
                else Box(Modifier.fillMaxWidth().aspectRatio(1.6f))
            }
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            IcoAction("heart", { feed.toggleLike(p) }, count = p.likes, active = p.liked, activeColor = C.bad)
            IcoAction("comment", { feed.toggleComments(p) }, count = p.comments, active = open)
            Box(Modifier.weight(1f))
            IcoAction("bookmark", { feed.toggleSave(p) }, active = p.saved)
        }
        if (open) CommentsBlock(model, p)
    }
}

@Composable
private fun CommentsBlock(model: AppModel, p: Post) {
    val feed = model.feed
    var text by remember(p.id) { mutableStateOf("") }
    var error by remember(p.id) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val list = feed.comments[p.id].orEmpty()
    Spacer(Modifier.height(8.dp))
    Box(Modifier.fillMaxWidth().height(1.dp).background(C.hair))
    Spacer(Modifier.height(10.dp))
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        when {
            p.id in feed.commentsLoading && list.isEmpty() -> Txt(t("common.loading"), 13, color = C.g500)
            list.isEmpty() -> Txt(t("feed.noComments"), 13, color = C.g500)
            else -> list.forEach { CommentRowView(model, it, it.author.id == model.api.session?.userId) }
        }
        TextArea(text, { text = it; error = null }, t("feed.commentPlaceholder"), minHeight = 44.dp)
        error?.let { Txt(t(it), 13, FontWeight.Medium, C.bad) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            KeyButton(t("feed.commentSubmit"), {
                if (text.isNotBlank()) scope.launch { val e = feed.comment(p, text); if (e == null) text = "" else error = e }
            }, enabled = text.isNotBlank())
        }
    }
}

@Composable
fun FeedScreen(model: AppModel) {
    val feed = model.feed
    LaunchedEffect(Unit) { if (!feed.loaded && !feed.loading) feed.load() }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Txt(t("feed.title"), 24, FontWeight.ExtraBold, C.g50)
        Segmented(listOf(t("feed.tabAll"), t("feed.tabMine"), t("favorites.title")), feed.mode, { feed.showMode(it) })
        Composer(model)
        feed.notice?.let { Chip(t(it), Tone.Info) }
        when {
            feed.failed && !feed.loaded -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("feed.loadErrorTitle"), 16, FontWeight.Bold, C.g50)
                Spacer(Modifier.height(4.dp))
                Txt(t("feed.loadErrorBody"), 13, color = C.g400)
                Spacer(Modifier.height(12.dp))
                KeyButton(t("common.retry"), { feed.load() })
            }
            !feed.loaded -> Txt(t("common.loading"), 14, color = C.g500)
            feed.posts.isEmpty() -> Plate(Modifier.fillMaxWidth()) {
                Txt(when (feed.mode) { 1 -> t("feed.mineEmptyTitle"); 2 -> t("favorites.emptyTitle"); else -> t("feed.emptyTitle") }, 16, FontWeight.Bold, C.g50)
                Spacer(Modifier.height(4.dp))
                Txt(when (feed.mode) { 1 -> t("feed.mineEmptyBody"); 2 -> t("favorites.emptyBody"); else -> t("feed.emptyBody") }, 13, color = C.g400)
            }
            else -> {
                feed.posts.forEach { PostCard(model, it) }
                if (feed.hasMore) KeyButton(if (feed.loadingMore) t("common.loading") else t("feed.loadMore"), { feed.loadMore() }, Modifier.fillMaxWidth(), enabled = !feed.loadingMore)
            }
        }
    }
}
