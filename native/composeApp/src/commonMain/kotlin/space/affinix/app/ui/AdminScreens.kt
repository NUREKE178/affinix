package space.affinix.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import space.affinix.app.i18n.t
import space.affinix.app.net.Person
import space.affinix.app.store.AdminModel
import space.affinix.app.store.AdminModel.Status
import space.affinix.app.store.AdminModel.Tab
import space.affinix.app.store.AppModel
import space.affinix.app.store.Tab as AppTab

/** The admin panel of the platform: administrators and the owner only (the database decides; this asks and shows). */
@Composable
internal fun AdminScreen(model: AppModel) {
    val a = model.admin
    LaunchedEffect(Unit) { if (!a.meLoaded) a.loadMe() }
    LaunchedEffect(a.notice) { if (a.notice != null) { delay(3400); a.notice = null } }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IcoAction("arrowLeft", { model.tab = AppTab.Profile })
            Txt(t("admin.title"), 24, FontWeight.ExtraBold, C.g50, Modifier.weight(1f, fill = false))
            if (a.isOwner) Chip(t("team.roles.owner"), Tone.Signal) else if (a.isAdmin) Chip(t("team.roles.admin"), Tone.Info)
        }
        Txt(t("admin.subtitle"), 12, color = C.g500)
        a.notice?.let { Chip(t(it, "name" to a.noticeName), Tone.Info) }
        when {
            !a.meLoaded -> LoadingState()
            !a.isAdmin -> Plate(Modifier.fillMaxWidth()) {
                Txt(t("admin.noAccessTitle"), 15, FontWeight.Bold, C.g50); Spacer(Modifier.height(4.dp)); Txt(t("admin.noAccessBody"), 13, color = C.g400)
            }
            else -> {
                SwipeSections(a.tab.ordinal, Tab.values().size) { a.tab = Tab.values()[it] }
                Segmented(Tab.values().map { t("admin.tabs.${it.name.lowercase()}") }, a.tab.ordinal, { a.tab = Tab.values()[it] })
                when (a.tab) {
                    Tab.Overview -> OverviewTab(a)
                    Tab.People -> PeopleTab(model, a)
                    Tab.Moderation -> ModerationTab(model, a)
                    Tab.Log -> LogTab(a)
                }
            }
        }
    }
}

@Composable
private fun AdminError(code: String?, onRetry: () -> Unit) {
    val pending = code == "updatePending"
    Plate(Modifier.fillMaxWidth()) {
        Txt(t(if (code == "noAccess") "admin.noAccessTitle" else if (pending) "admin.pendingTitle" else "admin.errorTitle"), 15, FontWeight.Bold, C.g50)
        Spacer(Modifier.height(4.dp))
        Txt(t(if (code == "noAccess") "admin.noAccessBody" else if (pending) "admin.pendingBody" else "admin.errorBody"), 13, color = C.g400)
        if (!pending && code != "noAccess") { Spacer(Modifier.height(10.dp)); KeyButton(t("common.retry"), onRetry, compact = true) }
    }
}

// ---- overview ----------------------------------------------------------------------------------------------------------------------

@Composable
private fun OverviewTab(a: AdminModel) {
    LaunchedEffect(Unit) { if (a.overviewStatus == Status.Idle) a.loadOverview() }
    val o = a.overview
    when {
        a.overviewStatus == Status.Error -> AdminError(a.overviewError) { a.loadOverview() }
        o == null -> LoadingState()
        else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val flagged = o.testsFlagged
            Plate(Modifier.fillMaxWidth(), pad = 14) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(if (flagged > 0) Modifier.breathe(.16f, 1300) else Modifier) { Ico(if (flagged > 0) "shield" else "check", color = if (flagged > 0) C.warn else C.ok, size = 26.dp) }
                    Column(Modifier.weight(1f)) {
                        Txt(t("admin.overview.attention"), 15, FontWeight.ExtraBold, C.g50)
                        Txt(if (flagged > 0) t("admin.overview.flaggedBody", "n" to flagged) else t("admin.overview.allClear"), 13, color = C.g400)
                    }
                }
                if (flagged > 0) { Spacer(Modifier.height(10.dp)); KeyButton(t("admin.overview.openModeration"), { a.tab = Tab.Moderation }, lit = true, compact = true) }
            }
            Group(t("admin.overview.people"), listOf(t("admin.overview.users") to o.users, t("admin.overview.newUsers") to o.newUsers7d, t("admin.overview.active") to o.active7d, t("admin.overview.admins") to o.admins))
            Group(t("admin.overview.content"), listOf(t("admin.overview.posts") to o.posts, t("admin.overview.comments") to o.comments, t("admin.overview.messages") to o.messages7d, t("admin.overview.friendships") to o.friendships))
            Group(t("admin.overview.research"), listOf(t("admin.overview.companies") to o.companies, t("admin.overview.experiments") to o.experiments, t("admin.overview.responses") to o.responses))
            Group(t("admin.overview.arena"), listOf(t("admin.overview.players") to o.arenaPlayers, t("admin.overview.testsOpen") to o.testsOpen, t("admin.overview.testsFlagged") to o.testsFlagged))
            a.stats?.let { ArenaChart(it) }
        }
    }
}

@Composable
private fun Group(title: String, items: List<Pair<String, Int>>) {
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Txt(title, 11, FontWeight.Medium, C.g500)
        Spacer(Modifier.height(8.dp))
        items.chunked(2).forEachIndexed { i, row ->
            if (i > 0) Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (label, n) ->
                    Column(Modifier.weight(1f)) {
                        CountText(n, 24)
                        Txt(label, 11, FontWeight.Medium, C.g400, maxLines = 2)
                    }
                }
                if (row.size == 1) Box(Modifier.weight(1f))
            }
        }
    }
}

/** the Arena's last fortnight: votes per day as bars that grow in, and the time people stay in the Daily Challenge */
@Composable
private fun ArenaChart(s: AdminModel.ArenaStats) {
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(t("arena.admin.title"), 11, FontWeight.Medium, C.g500, Modifier.weight(1f))
            Chip(t("arena.admin.badge"), Tone.Neutral)
        }
        Spacer(Modifier.height(2.dp))
        Txt(t("arena.admin.note"), 11, color = C.g500)
        Spacer(Modifier.height(10.dp))
        val last = s.days.lastOrNull()
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) { CountText(s.players, 20); Txt(t("arena.admin.players"), 11, FontWeight.Medium, C.g400, maxLines = 2) }
            Column(Modifier.weight(1f)) { Txt(last?.avgMinutes?.toString() ?: "—", 20, FontWeight.ExtraBold, C.g50, maxLines = 1); Txt(t("arena.admin.avg"), 11, FontWeight.Medium, C.g400, maxLines = 2) }
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) { Txt(last?.over1h?.toString() ?: "—", 20, FontWeight.ExtraBold, C.g50); Txt(t("arena.admin.over1h"), 11, FontWeight.Medium, C.g400, maxLines = 2) }
            Column(Modifier.weight(1f)) { Txt(last?.over3h?.toString() ?: "—", 20, FontWeight.ExtraBold, C.g50); Txt(t("arena.admin.over3h"), 11, FontWeight.Medium, C.g400, maxLines = 2) }
        }
        if (s.days.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            Txt(t("arena.admin.votes"), 11, FontWeight.Medium, C.g500)
            Spacer(Modifier.height(6.dp))
            val peak = s.days.maxOf { it.votes }.coerceAtLeast(1)
            Row(Modifier.fillMaxWidth().height(96.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom) {
                s.days.forEachIndexed { i, d ->
                    val frac = rememberGrow(d.votes.toFloat() / peak, 650 + i * 55).coerceIn(0.03f, 1f)
                    Box(Modifier.weight(1f).fillMaxHeight(frac).lit(3.dp))
                }
            }
            Spacer(Modifier.height(4.dp))
            Row(Modifier.fillMaxWidth()) {
                Txt(s.days.first().day.drop(5), 10, color = C.g500, modifier = Modifier.weight(1f))
                Txt(s.days.last().day.drop(5), 10, color = C.g500)
            }
        }
    }
}

// ---- people ----------------------------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PeopleTab(model: AppModel, a: AdminModel) {
    LaunchedEffect(Unit) { if (a.peopleStatus == Status.Idle) a.loadPeople() }
    var confirm by remember { mutableStateOf<Pair<AdminModel.Person, Boolean>?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Field(a.peopleQuery, { a.search(it) }, t("admin.people.search"))
        Txt(t("admin.people.found", "count" to grouped(a.peopleTotal)), 12, color = C.g500)
        if (!a.isOwner) Txt(t("admin.people.onlyOwner"), 12, color = C.g500)
        confirm?.let { (p, grant) ->
            Plate(Modifier.fillMaxWidth(), pad = 14) {
                Txt(t(if (grant) "admin.people.confirmGrantTitle" else "admin.people.confirmRevokeTitle", "name" to p.label), 15, FontWeight.Bold, C.g50)
                Spacer(Modifier.height(4.dp))
                Txt(t(if (grant) "admin.people.confirmGrantBody" else "admin.people.confirmRevokeBody"), 13, color = C.g400)
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    KeyButton(t(if (grant) "admin.people.grant" else "admin.people.revoke"), { a.setAdmin(p, grant); confirm = null }, lit = true, compact = true)
                    KeyButton(t("common.cancel"), { confirm = null }, compact = true)
                }
            }
        }
        when {
            a.peopleStatus == Status.Error -> AdminError(a.peopleError) { a.loadPeople() }
            a.peopleStatus != Status.Ready -> SkeletonList(4)
            a.people.isEmpty() -> Plate(Modifier.fillMaxWidth()) { Txt(t("admin.people.emptyTitle"), 15, FontWeight.Bold, C.g50); Spacer(Modifier.height(4.dp)); Txt(t("admin.people.emptyBody"), 13, color = C.g400) }
            else -> {
                a.people.forEach { p ->
                    Plate(Modifier.fillMaxWidth(), radius = 14, pad = 12) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Avatar(model, Person(p.id, p.name, p.username, p.avatarUrl), 42.dp)
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Txt(p.label, 14, FontWeight.ExtraBold, C.g50, Modifier.weight(1f, fill = false), maxLines = 1)
                                    if (p.id == model.api.session?.userId) Chip(t("admin.people.you"), Tone.Neutral)
                                }
                                Txt((p.username?.let { "@$it · " } ?: "") + (p.email ?: ""), 11, color = C.g500, maxLines = 1)
                            }
                            if (p.isOwner) Chip(t("team.roles.owner"), Tone.Signal) else if (p.isAdmin) Chip(t("team.roles.admin"), Tone.Info)
                        }
                        Spacer(Modifier.height(8.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            p.company?.let { Chip(it + (p.companyRole?.let { r -> " · " + t("team.roles.$r") } ?: ""), Tone.Neutral) }
                            Txt(t("admin.people.posts", "n" to grouped(p.posts)), 12, color = C.g400)
                            Txt("${grouped(p.xp.toInt())} XP", 12, color = C.g400)
                            Txt(t("admin.people.joined", "date" to p.joinedAt.take(10)), 12, color = C.g500)
                        }
                        if (a.isOwner && !p.isOwner) {
                            Spacer(Modifier.height(8.dp))
                            KeyButton(t(if (p.isAdmin) "admin.people.revoke" else "admin.people.grant"), { confirm = p to !p.isAdmin }, compact = true, enabled = a.busyId != p.id)
                        }
                    }
                }
                if (a.people.size < a.peopleTotal) KeyButton(t("admin.people.loadMore"), a::loadMore, compact = true, enabled = !a.loadingMore)
            }
        }
    }
}

// ---- moderation ------------------------------------------------------------------------------------------------------------------------

@Composable
private fun ModerationTab(model: AppModel, a: AdminModel) {
    LaunchedEffect(Unit) { if (a.moderationStatus == Status.Idle) a.loadModeration() }
    var confirm by remember { mutableStateOf<AdminModel.Content?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Plate(Modifier.fillMaxWidth(), pad = 14) {
            Txt(t("crowd.admin.title"), 11, FontWeight.Medium, C.g500)
            Spacer(Modifier.height(6.dp))
            if (a.flagged.isEmpty()) Txt(t("crowd.admin.empty"), 13, color = C.g400)
            a.flagged.forEach { f ->
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Txt(f.title, 14, FontWeight.Bold, C.g50, Modifier.weight(1f, fill = false), maxLines = 2)
                        Chip(t("crowd.status.${f.status}"), if (f.status == "removed") Tone.Bad else Tone.Warn)
                    }
                    Txt((f.owner ?: "—") + " · " + t("crowd.admin.reports", "n" to f.reports) + f.reasons.takeIf { it.isNotEmpty() }?.let { r -> " · " + r.joinToString(", ") { "“$it”" } }.orEmpty(), 12, color = C.g500)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (f.status != "removed") KeyButton(t("crowd.admin.remove"), { a.moderateTest(f, "remove") }, compact = true, enabled = a.moderating != f.id)
                        if (f.status == "removed" || f.status == "flagged" || f.reports > 0) KeyButton(t("crowd.admin.restore"), { a.moderateTest(f, "restore") }, compact = true, enabled = a.moderating != f.id)
                    }
                    Spacer(Modifier.height(6.dp))
                }
            }
            Txt(t("admin.moderation.reportsHint"), 11, color = C.g500)
        }
        confirm?.let { c ->
            Plate(Modifier.fillMaxWidth(), pad = 14) {
                Txt(t(if (c.kind == "post") "admin.moderation.confirmPostTitle" else "admin.moderation.confirmCommentTitle"), 15, FontWeight.Bold, C.g50)
                Spacer(Modifier.height(4.dp))
                Txt(t("admin.moderation.confirmBody"), 13, color = C.g400)
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    KeyButton(t("admin.moderation.remove"), { a.removeContent(c); confirm = null }, lit = true, compact = true)
                    KeyButton(t("common.cancel"), { confirm = null }, compact = true)
                }
            }
        }
        when {
            a.moderationStatus == Status.Error -> AdminError(a.moderationError) { a.loadModeration() }
            a.moderationStatus != Status.Ready -> SkeletonList(4)
            else -> {
                ContentList(model, t("admin.moderation.postsTitle"), a.posts) { confirm = it }
                ContentList(model, t("admin.moderation.commentsTitle"), a.comments) { confirm = it }
            }
        }
    }
}

@Composable
private fun ContentList(model: AppModel, title: String, list: List<AdminModel.Content>, onRemove: (AdminModel.Content) -> Unit) {
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Txt(title, 11, FontWeight.Medium, C.g500)
        Spacer(Modifier.height(8.dp))
        if (list.isEmpty()) Txt(t("admin.moderation.empty"), 13, color = C.g400)
        list.forEach { c ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Avatar(model, c.author, 32.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Txt(c.author.name ?: t("feed.unknownAuthor"), 13, FontWeight.Bold, C.g100, Modifier.weight(1f, fill = false), maxLines = 1)
                        Txt(agoText(c.createdAt), 11, color = C.g500)
                    }
                    Txt(c.body, 13, color = C.g300, maxLines = 4)
                    if (c.hasImage) Txt(t("admin.moderation.hasImage"), 11, color = C.g500)
                    KeyButton(t("admin.moderation.remove"), { onRemove(c) }, compact = true)
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

// ---- the log ---------------------------------------------------------------------------------------------------------------------------

private val LOG_ICON = mapOf("admin_granted" to "userPlus", "admin_revoked" to "userCheck", "post_removed" to "trash", "comment_removed" to "trash", "owner_set" to "crown")

@Composable
private fun LogTab(a: AdminModel) {
    LaunchedEffect(Unit) { if (a.logStatus == Status.Idle) a.loadLog() }
    when {
        a.logStatus == Status.Error -> AdminError(a.logError) { a.loadLog() }
        a.logStatus != Status.Ready -> SkeletonList(5, avatar = false)
        a.log.isEmpty() -> Plate(Modifier.fillMaxWidth()) { Txt(t("admin.log.emptyTitle"), 15, FontWeight.Bold, C.g50); Spacer(Modifier.height(4.dp)); Txt(t("admin.log.emptyBody"), 13, color = C.g400) }
        else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            a.log.forEach { r ->
                Plate(Modifier.fillMaxWidth(), radius = 14, pad = 12) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                        Ico(LOG_ICON[r.action] ?: "shield", color = C.signalHi, size = 20.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            val key = "admin.log.actions.${r.action}"
                            val label = t(key)
                            Txt(if (label == key) r.action else label, 14, FontWeight.Bold, C.g50)
                            if (r.action != "owner_set") Txt(t("admin.log.by") + ": " + (r.actor ?: t("admin.log.system")), 12, color = C.g400)
                            Txt(t(if (r.action.endsWith("_removed")) "admin.log.author" else "admin.log.target") + ": " + (r.target ?: "—"), 12, color = C.g400)
                            r.excerpt?.let { Txt("“$it”", 12, color = C.g500, maxLines = 3) }
                        }
                        Txt(agoText(r.at), 11, color = C.g500)
                    }
                }
            }
        }
    }
}
