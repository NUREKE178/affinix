package space.affinix.app.ui

import androidx.compose.foundation.layout.Arrangement
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

@Composable
private fun Row2(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Txt(label, 14, color = C.g400)
        Txt(value, 14, FontWeight.Bold, C.g50)
    }
}

/** The same awards as on the website: the ids come from the translations, the player's own from arena_state. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Badges(model: AppModel) {
    val mine = model.profile?.badges.orEmpty().toSet()
    val ids = space.affinix.app.Rules.BADGE_IDS
    Plate(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Txt(t("arena.profile.badges"), 14, FontWeight.Bold, C.g200)
            Txt("${ids.count { it in mine }} / ${ids.size}", 13, FontWeight.Bold, C.g500)
        }
        Spacer(Modifier.height(10.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (id in ids) Chip(space.affinix.app.i18n.badgeName(id), if (id in mine) Tone.Signal else Tone.Neutral, Modifier.then(if (id in mine) Modifier else Modifier.alphaDim()))
        }
    }
}

private fun Modifier.alphaDim(): Modifier = this.then(Modifier.alpha(.45f))

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

/** My picture and the key that changes it. */
@Composable
private fun MyPhoto(model: AppModel) {
    val me = model.myProfile
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf<String?>(null) }
    Plate(Modifier.fillMaxWidth(), pad = 14) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Avatar(model, space.affinix.app.net.Person(model.api.session?.userId.orEmpty(), me?.fullName, me?.username, me?.avatarUrl), 64.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt(me?.fullName?.ifBlank { null } ?: model.email, 16, FontWeight.ExtraBold, C.g50, maxLines = 1)
                KeyButton(if (model.avatarBusy) t("common.saving") else t("app.changePhoto"), { scope.launch { note = model.changeAvatar() } }, compact = true, enabled = !model.avatarBusy)
                note?.let { Txt(t(it), 12, FontWeight.Medium, if (it == "app.photoSaved") C.ok else C.bad) }
            }
        }
    }
}

@Composable
fun ProfileScreen(model: AppModel) {
    val p = model.profile
    LaunchedEffect(Unit) { if (model.myProfile == null) model.loadMyProfile() }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        LevelHeader(model)
        MyPhoto(model)
        Plate(Modifier.fillMaxWidth()) {
            Txt(t("app.signedInAs", "email" to model.email), 13, color = C.g400)
            Spacer(Modifier.height(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row2(t("app.xp"), "${p?.xp ?: 0}")
                Row2(t("arena.lobby.statStreak"), t("app.streakDays", "n" to (p?.streak ?: 0)))
                Row2(t("arena.lobby.statDuels"), "${p?.votes ?: 0}")
                Row2(t("arena.summary.combo"), "${p?.bestCombo ?: 0}")
                Row2(t("arena.lobby.statEye"), if ((p?.eyeTotal ?: 0) == 0) "–" else "${p?.eyeCorrect}/${p?.eyeTotal}")
            }
        }
        DnaCard(model)
        Badges(model)
        EditProfile(model)
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
        KeyButton(t("shell.userMenu.logout"), model::signOut, Modifier.fillMaxWidth(), big = true)
    }
}
