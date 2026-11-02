package space.affinix.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel

/** The same awards as on the website: the ids come from the translations, the player's own from arena_state. Shown as medals: lit when earned, a lock when not. */
@Composable
private fun Badges(model: AppModel) {
    val mine = model.profile?.badges.orEmpty().toSet()
    val ids = space.affinix.app.Rules.BADGE_IDS
    Plate(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Txt(t("arena.profile.badges"), T.Body, FontWeight.ExtraBold, C.g100)
            Chip("${ids.count { it in mine }} / ${ids.size}", if (ids.any { it in mine }) Tone.Signal else Tone.Neutral)
        }
        Spacer(Modifier.height(12.dp))
        // the earned ones first, in the order of the website
        val ordered = ids.filter { it in mine } + ids.filter { it !in mine }
        ordered.chunked(4).forEach { row ->
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                row.forEach { id -> MedalTile(space.affinix.app.i18n.badgeName(id), id in mine, Modifier.weight(1f)) }
                repeat(4 - row.size) { Box(Modifier.weight(1f)) }
            }
        }
    }
}


@Composable
private fun EditProfile(model: AppModel) {
    val me = model.myProfile
    var name by remember(me) { mutableStateOf(me?.fullName.orEmpty()) }
    var user by remember(me) { mutableStateOf(me?.username.orEmpty()) }
    var role by remember(me) { mutableStateOf(me?.roleTitle.orEmpty()) }
    var bio by remember(me) { mutableStateOf(me?.bio.orEmpty()) }
    var msg by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val userBad = !model.usernameOk(user.trim().lowercase())
    Plate(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Field(name, { name = it; msg = null }, t("profile.personal.fullNameLabel"), imeDone = false)
            Field(user, { user = it.lowercase(); msg = null }, t("profile.personal.usernameLabel"), imeDone = false)
            Txt(if (userBad) t("profile.personal.usernameHintInvalid") else t("profile.personal.usernameHint"), 12, color = if (userBad) C.bad else C.g500)
            Field(role, { role = it; msg = null }, t("profile.personal.roleTitleLabel"), imeDone = false)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt(t("profile.personal.bioLabel"), 12, FontWeight.Medium, C.g400)
                TextArea(bio, { bio = it; msg = null }, "", minHeight = 70.dp)
            }
            msg?.let { Txt(t(it.first), 13, FontWeight.Medium, if (it.second) C.ok else C.bad) }
            KeyButton(if (busy) t("common.saving") else t("profile.personal.saveButton"), {
                busy = true
                scope.launch { val e = model.saveMyProfile(name, user, role, bio); msg = (e ?: "profile.personal.profileSaved") to (e == null); busy = false }
            }, Modifier.fillMaxWidth(), lit = true, enabled = !busy && !userBad)
        }
    }
}

/** Who I am: the picture, the name, the level with its progress, and the two keys that change what others see. */
@Composable
private fun ProfileHero(model: AppModel, editing: Boolean, onEdit: () -> Unit) {
    val me = model.myProfile
    val prog = space.affinix.app.Rules.levelProgress(model.profile?.xp ?: 0)
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf<String?>(null) }
    Plate(Modifier.fillMaxWidth(), pad = 18) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Avatar(model, space.affinix.app.net.Person(model.api.session?.userId.orEmpty(), me?.fullName, me?.username, me?.avatarUrl), 72.dp, opens = false)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Txt(me?.fullName?.ifBlank { null } ?: model.email, T.Title - 2, FontWeight.ExtraBold, C.g50, maxLines = 2)
                me?.username?.takeIf { it.isNotBlank() }?.let { Txt("@$it", T.Small + 1, FontWeight.Medium, C.signalHi, maxLines = 1) }
                me?.roleTitle?.takeIf { it.isNotBlank() }?.let { Txt(it, T.Small, color = C.g400, maxLines = 1) }
            }
        }
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("${t("arena.level")} ${prog.level}", Tone.Signal)
            Chip(t("arena.rank.${space.affinix.app.Rules.rankForLevel(prog.level)}"), Tone.Neutral)
            Box(Modifier.weight(1f))
            Txt("${prog.into} / ${prog.span} ${t("app.xp")}", T.Small - 1, FontWeight.Medium, C.g400)
        }
        Spacer(Modifier.height(8.dp))
        Bar(prog.ratio)
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            KeyButton(if (editing) t("common.back") else t("app.editProfile"), onEdit, Modifier.weight(1f), compact = true)
            KeyButton(if (model.avatarBusy) t("common.saving") else t("app.changePhoto"), { scope.launch { note = model.changeAvatar() } }, Modifier.weight(1f), compact = true, enabled = !model.avatarBusy)
        }
        note?.let { Spacer(Modifier.height(6.dp)); Txt(t(it), 12, FontWeight.Medium, if (it == "app.photoSaved") C.ok else C.bad) }
    }
}

@Composable
fun ProfileScreen(model: AppModel) {
    val p = model.profile
    var editing by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { if (model.myProfile == null) model.loadMyProfile() }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        ScreenHeader(t("arena.tabs.profile")) { ArenaActions(model) }
        ProfileHero(model, editing) { editing = !editing }
        if (editing) EditProfile(model)
        LaunchedEffect(Unit) { if (!model.admin.meLoaded) model.admin.loadMe() }
        if (model.admin.isAdmin) Plate(Modifier.fillMaxWidth(), pad = 16) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Ico("shield", color = C.signalHi, size = 22.dp)
                Txt(t("admin.title"), 16, FontWeight.ExtraBold, C.g50, Modifier.weight(1f))
                Chip(if (model.admin.isOwner) t("team.roles.owner") else t("team.roles.admin"), if (model.admin.isOwner) Tone.Signal else Tone.Info)
            }
            Spacer(Modifier.height(4.dp))
            Txt(t("admin.subtitle"), 12, color = C.g400)
            Spacer(Modifier.height(10.dp))
            KeyButton(t("shell.workspace.admin"), { model.tab = space.affinix.app.store.Tab.Admin }, Modifier.fillMaxWidth())
        }
        SectionLabel(t("app.statsTitle"))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile(t("app.xp"), grouped((p?.xp ?: 0).toInt()), Modifier.weight(1f))
            StatTile(t("arena.level"), "${space.affinix.app.Rules.levelProgress(p?.xp ?: 0).level}", Modifier.weight(1f))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile(t("arena.lobby.statStreak"), "${p?.streak ?: 0}", Modifier.weight(1f))
            StatTile(t("arena.lobby.statDuels"), grouped(p?.votes ?: 0), Modifier.weight(1f))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile(t("arena.summary.combo"), "${p?.bestCombo ?: 0}", Modifier.weight(1f))
            StatTile(t("arena.lobby.statEye"), if ((p?.eyeTotal ?: 0) == 0) "–" else "${p?.eyeCorrect}/${p?.eyeTotal}", Modifier.weight(1f))
        }
        DnaCard(model)
        Badges(model)
        Plate(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Column(Modifier.weight(1f)) {
                    Txt(t("arena.rankings.visible"), 14, FontWeight.Bold, C.g100)
                    Spacer(Modifier.height(2.dp))
                    Txt(t("arena.rankings.visibleHint"), 12, color = C.g500)
                }
                Toggle(p?.visible ?: true, { model.setVisible(it) })
            }
        }
        Plate(Modifier.fillMaxWidth()) {
            Txt(t("app.language"), 14, FontWeight.Bold, C.g200)
            Spacer(Modifier.height(10.dp))
            LangSwitch(model.lang, model::changeLang)
        }
        Txt(t("app.signedInAs", "email" to model.email), 12, color = C.g500, modifier = Modifier.fillMaxWidth(), align = androidx.compose.ui.text.style.TextAlign.Center)
        KeyButton(t("shell.userMenu.logout"), model::signOut, Modifier.fillMaxWidth(), big = true)
    }
}
