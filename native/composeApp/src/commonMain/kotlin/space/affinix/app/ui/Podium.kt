package space.affinix.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import space.affinix.app.i18n.t
import space.affinix.app.net.LeaderRow
import space.affinix.app.store.AppModel

private val Gold = Color(0xFFF3C35A)
private val Silver = Color(0xFFC5C9D3)
private val Bronze = Color(0xFFD98E5C)

/** What the first three look like, by place in the ranked list (0 = leader): the colour of the ring and the numeral, the height of the stand, the size of the picture. */
private class Place(val metal: Color, val stand: Dp, val photo: Dp)

private val Places = listOf(Place(Gold, 106.dp, 68.dp), Place(Silver, 78.dp, 56.dp), Place(Bronze, 56.dp, 56.dp))

/**
 * The top three of the rankings on a podium: the leader in the middle, the tallest, with a crown; second place on its left and third on its right, lower. The place is also a numeral
 * on the stand, never only a colour. A tap on a person opens their profile card.
 */
@Composable
fun Podium(model: AppModel, rows: List<LeaderRow>, allTime: Boolean) {
    val order = podiumOrder(rows.size)
    if (order.isEmpty()) return
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
        // fewer than three people: the places that exist keep their width, so that the leader still stands in the middle of the row
        if (order.size == 1) Spacer(Modifier.weight(1f))
        order.forEach { i -> Column(Modifier.weight(1f)) { Step(model, rows[i], Places[i], i, allTime) } }
        if (order.size == 1) Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun Step(model: AppModel, row: LeaderRow, place: Place, index: Int, allTime: Boolean) {
    val who = row.person()
    // the stands rise from the floor when the screen opens; later changes of the same list move smoothly
    val rise = rememberGrow(1f, 700 + index * 120)
    val said = "${t("arena.rankings.place", "n" to row.rank)}: ${row.name}, ${row.xp} ${t("app.xp")}"
    Column(
        Modifier.fillMaxWidth().enter(index).personTap(model, who, row.arenaInfo(allTime)).semantics { contentDescription = said },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (index == 0) Ico("crown", color = Gold, size = 26.dp, filled = true) else Spacer(Modifier.height(26.dp))
        Spacer(Modifier.height(4.dp))
        Box(
            Modifier.border(3.dp, place.metal, CircleShape).padding(3.dp),
            contentAlignment = Alignment.Center,
        ) { Avatar(model, who, place.photo, opens = false) }
        Spacer(Modifier.height(8.dp))
        Txt(row.name.ifBlank { "–" }, if (index == 0) 15 else 13, FontWeight.Bold, if (row.isMe) C.signalHi else C.g50, align = TextAlign.Center, maxLines = 1)
        Txt("${row.xp} ${t("app.xp")}", 12, FontWeight.ExtraBold, C.g300, align = TextAlign.Center, maxLines = 1)
        Spacer(Modifier.height(8.dp))
        Box(
            Modifier.fillMaxWidth().height(place.stand * rise)
                .background(Brush.verticalGradient(listOf(place.metal.copy(alpha = .28f), C.g900)), RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp))
                .border(1.dp, place.metal.copy(alpha = .35f), RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)),
            contentAlignment = Alignment.TopCenter,
        ) {
            Txt("${row.rank}", if (index == 0) 34 else 26, FontWeight.ExtraBold, place.metal, Modifier.padding(top = 8.dp))
        }
    }
}
