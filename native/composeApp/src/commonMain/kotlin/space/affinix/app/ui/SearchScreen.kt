package space.affinix.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel
import space.affinix.app.store.SearchModel
import space.affinix.app.store.Tab

/** The screens of the app, searchable by name (the website searches its pages the same way). */
@Composable
private fun pages(): List<Pair<String, Pair<Tab, String>>> = listOf(
    t("arena.title") to (Tab.Play to "arena"),
    t("arena.tabs.quests") to (Tab.Quests to "target"),
    t("arena.tabs.rankings") to (Tab.Rankings to "trophy"),
    t("feed.title") to (Tab.Feed to "globe"),
    t("messages.title") to (Tab.Chats to "chat"),
    t("friends.title") to (Tab.People to "friends"),
    t("arena.tabs.profile") to (Tab.Profile to "user"),
    t("shell.notifications.title") to (Tab.Notifications to "bell"),
)

@Composable
fun SearchScreen(model: AppModel) {
    val s = model.search
    LaunchedEffect(Unit) { model.people.load() } // so a person's friend button knows the relation
    val q = SearchModel.cleanText(s.query)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IcoAction("arrowLeft", { s.clear(); model.tab = Tab.Play })
            Txt(t("search.aria"), 20, FontWeight.ExtraBold, C.g50)
        }
        SearchField(s.query, s::type, t("search.aria"))
        Txt(t("search.scope"), 12, color = C.g500)

        val pageHits = SearchModel.matchPages(pages(), s.query)
        if (pageHits.isNotEmpty()) {
            Plate(Modifier.fillMaxWidth(), pad = 12) {
                Txt(t("search.pages"), 13, FontWeight.ExtraBold, C.g400, spacing = .4f)
                Spacer(Modifier.height(4.dp))
                pageHits.forEach { (label, target) ->
                    Row(
                        Modifier.fillMaxWidth().clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { s.clear(); model.tab = target.first }.padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) { Ico(target.second, color = C.g300, size = 20.dp); Txt(label, 15, FontWeight.Bold, C.g50) }
                }
            }
        }

        if (q.length >= SearchModel.MIN_TEXT) {
            when {
                s.searching && s.persons.isEmpty() && s.posts.isEmpty() -> Txt(t("search.searching"), 14, color = C.g500)
                s.failed >= 2 -> Chip(t("search.error"), Tone.Bad)
                s.persons.isEmpty() && s.posts.isEmpty() -> Txt(t("search.empty"), 14, color = C.g500)
                else -> {
                    if (s.failed > 0) Chip(t("search.error"), Tone.Warn)
                    if (s.persons.isNotEmpty()) Plate(Modifier.fillMaxWidth(), pad = 12) {
                        Txt(t("search.people"), 13, FontWeight.ExtraBold, C.g400, spacing = .4f)
                        s.persons.forEach { p -> PersonRow(model, p) { Relation(model, p) } }
                    }
                    if (s.posts.isNotEmpty()) Plate(Modifier.fillMaxWidth(), pad = 12) {
                        Txt(t("search.posts"), 13, FontWeight.ExtraBold, C.g400, spacing = .4f)
                        s.posts.forEach { h ->
                            Column(
                                Modifier.fillMaxWidth().clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { s.clear(); model.tab = Tab.Feed }.padding(vertical = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(2.dp),
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Txt(h.author?.name ?: t("feed.unknownAuthor"), 13, FontWeight.ExtraBold, C.g50, Modifier.weight(1f), maxLines = 1)
                                    Txt(agoText(h.createdAt), 12, color = C.g500, maxLines = 1)
                                }
                                Txt(h.body, 13, color = C.g300, maxLines = 3)
                            }
                        }
                    }
                }
            }
        }
    }
}
