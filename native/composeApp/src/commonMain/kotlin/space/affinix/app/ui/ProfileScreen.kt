package space.affinix.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import space.affinix.app.i18n.t
import space.affinix.app.store.AppModel

@Composable
private fun Row2(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Txt(label, 14, color = C.g400)
        Txt(value, 14, FontWeight.Bold, C.g50)
    }
}

@Composable
fun ProfileScreen(model: AppModel) {
    val p = model.profile
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        LevelHeader(model)
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
        Plate(Modifier.fillMaxWidth()) {
            Txt(t("app.language"), 14, FontWeight.Bold, C.g200)
            Spacer(Modifier.height(10.dp))
            LangSwitch(model.lang, model::changeLang)
        }
        KeyButton(t("shell.userMenu.logout"), model::signOut, Modifier.fillMaxWidth(), big = true)
    }
}
