package space.affinix.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import space.affinix.app.i18n.t
import space.affinix.app.net.Friendship
import space.affinix.app.net.Person
import space.affinix.app.store.AppModel
import space.affinix.app.store.PeopleModel
import space.affinix.app.store.Tab

@Composable
fun SearchField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().well(12.dp).padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Ico("search", color = C.g500, size = 20.dp)
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Txt(placeholder, 15, color = C.g600, maxLines = 1)
            BasicTextField(
                value, onChange, singleLine = true, textStyle = ts(15, FontWeight.Medium, C.g50, LocalFonts.current.family), cursorBrush = SolidColor(C.signal),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), modifier = Modifier.fillMaxWidth(),
            )
        }
        if (value.isNotEmpty()) IcoAction("close", { onChange("") })
    }
}

@Composable
private fun PersonRow(model: AppModel, p: Person, trailing: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Avatar(model, p, 44.dp)
        Column(Modifier.weight(1f)) {
            Txt(p.name ?: t("feed.unknownAuthor"), 15, FontWeight.ExtraBold, C.g50, maxLines = 1)
            val sub = listOfNotNull(p.username?.let { "@$it" }, p.roleTitle).joinToString(" · ")
            if (sub.isNotBlank()) Txt(sub, 12, color = C.g500, maxLines = 1)
        }
        trailing()
    }
}

/** The right-hand button(s) of a person, depending on how they relate to the viewer. */
@Composable
private fun Relation(model: AppModel, p: Person) {
    val ppl = model.people
    val rel: Friendship? = ppl.relation(p.id)
    when {
        rel == null -> KeyButton(t("friends.addFriend"), { ppl.send(p.id) }, compact = true)
        rel.accepted -> KeyButton(t("friends.message"), { model.messages.openWith(p); model.tab = Tab.Chats }, lit = true, compact = true)
        rel.iRequested -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Chip(t("friends.requestSent"), Tone.Neutral); IcoAction("close", { ppl.remove(rel) })
        }
        else -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            KeyButton(t("friends.accept"), { ppl.accept(rel) }, lit = true, compact = true); IcoAction("close", { ppl.remove(rel) })
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Txt(title, 13, FontWeight.ExtraBold, C.g400, spacing = .4f)
        Spacer(Modifier.height(6.dp))
        content()
    }
}

@Composable
fun PeopleScreen(model: AppModel) {
    val ppl = model.people
    LaunchedEffect(Unit) { if (!ppl.loaded) ppl.load() }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Txt(t("friends.title"), 24, FontWeight.ExtraBold, C.g50)
        SearchField(ppl.query, ppl::search, t("people.searchPlaceholder"))
        ppl.notice?.let { Chip(t(it), Tone.Info) }
        val q = ppl.clean(ppl.query)
        when {
            q.isEmpty() || q.length < PeopleModel.MIN_QUERY -> {
                if (ppl.query.isNotEmpty()) Txt(t("people.searchHint", "min" to PeopleModel.MIN_QUERY), 13, color = C.g500)
                when {
                    ppl.failed && !ppl.loaded -> Plate(Modifier.fillMaxWidth()) {
                        Txt(t("friends.loadErrorTitle"), 16, FontWeight.Bold, C.g50); Spacer(Modifier.height(4.dp))
                        Txt(t("friends.loadErrorBody"), 13, color = C.g400); Spacer(Modifier.height(12.dp))
                        KeyButton(t("people.retry"), { ppl.load() })
                    }
                    !ppl.loaded -> Txt(t("common.loading"), 14, color = C.g500)
                    ppl.friends.isEmpty() && ppl.incoming.isEmpty() && ppl.outgoing.isEmpty() -> Plate(Modifier.fillMaxWidth()) {
                        Txt(t("friends.emptyTitle"), 16, FontWeight.Bold, C.g50); Spacer(Modifier.height(4.dp)); Txt(t("friends.emptyBody"), 13, color = C.g400)
                    }
                    else -> {
                        if (ppl.incoming.isNotEmpty()) Section(t("friends.incomingTitle", "count" to ppl.incoming.size)) { ppl.incoming.forEach { f -> PersonRow(model, f.other) { Relation(model, f.other) } } }
                        if (ppl.friends.isNotEmpty()) Section(t("friends.friendsTitle", "count" to ppl.friends.size)) {
                            ppl.friends.forEach { f -> PersonRow(model, f.other) { Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                KeyButton(t("friends.message"), { model.messages.openWith(f.other); model.tab = Tab.Chats }, lit = true, compact = true)
                                IcoAction("trash", { ppl.remove(f) })
                            } } }
                        }
                        if (ppl.outgoing.isNotEmpty()) Section(t("friends.outgoingTitle", "count" to ppl.outgoing.size)) { ppl.outgoing.forEach { f -> PersonRow(model, f.other) { Relation(model, f.other) } } }
                    }
                }
            }
            ppl.searchFailed -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("people.errorTitle"), 16, FontWeight.Bold, C.g50); Spacer(Modifier.height(4.dp)); Txt(t("people.errorBody"), 13, color = C.g400)
            }
            ppl.searching && ppl.results.isEmpty() -> Txt(t("common.loading"), 14, color = C.g500)
            ppl.results.isEmpty() -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("people.noResultsTitle"), 16, FontWeight.Bold, C.g50); Spacer(Modifier.height(4.dp)); Txt(t("people.noResultsBody", "query" to q), 13, color = C.g400)
            }
            else -> Plate(Modifier.fillMaxWidth(), pad = 12) { ppl.results.forEach { p -> PersonRow(model, p) { Relation(model, p) } } }
        }
    }
}
