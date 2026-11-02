package space.affinix.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * The shared layer of the design: one type scale, one header for every screen, tinted avatars, the tiles and medals that the screens share, and the docked row of actions of a
 * full-screen flow. A screen built from these looks like the rest of the product without having to remember its numbers.
 */
object T {
    const val Display = 26
    const val Title = 22
    const val Heading = 17
    const val Body = 15
    const val Small = 13
    const val Micro = 11
}

/** The title of a screen: the same size, weight and place everywhere, with an optional line under it and actions at the end. */
@Composable
fun ScreenHeader(title: String, subtitle: String? = null, modifier: Modifier = Modifier, trailing: @Composable RowScope.() -> Unit = {}) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Txt(title, T.Display, FontWeight.ExtraBold, C.g50, maxLines = 1)
            subtitle?.let { Txt(it, T.Small, color = C.g500, maxLines = 2) }
        }
        trailing()
    }
}

/** A small engraved caption above a group (all capitals, spaced out). */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Txt(text.uppercase(), T.Micro, FontWeight.ExtraBold, C.g500, modifier, spacing = 1.1f, maxLines = 1)
}

private val Tints = listOf(
    Color(0xFF3B2A20) to Color(0xFFFFB690), // orange
    Color(0xFF202C3E) to Color(0xFF9CC2FF), // blue
    Color(0xFF20352A) to Color(0xFF8FE3B0), // green
    Color(0xFF2E2540) to Color(0xFFC9B0FF), // violet
    Color(0xFF3B2230) to Color(0xFFFF9FC0), // rose
    Color(0xFF1E3538) to Color(0xFF8DE0E6), // teal
    Color(0xFF38301C) to Color(0xFFFFD98A), // amber
    Color(0xFF2A2D36) to Color(0xFFC3C9DA), // slate
)

/** The same person always gets the same tint (background, letter), so faces without a picture can be told apart at a glance. */
fun avatarTint(seed: String): Pair<Color, Color> {
    var h = 7
    for (c in seed) h = h * 31 + c.code
    return Tints[((h % Tints.size) + Tints.size) % Tints.size]
}

/** One figure with its caption (and a hint): the tiles of the profile and the summary. */
@Composable
fun StatTile(label: String, value: String, modifier: Modifier = Modifier, hint: String? = null) {
    Column(modifier.plate(14.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Txt(label, T.Small - 1, FontWeight.Medium, C.g400, maxLines = 1)
        Txt(value, T.Title + 2, FontWeight.ExtraBold, C.g50, maxLines = 1)
        hint?.let { Txt(it, T.Small - 1, color = C.g500, maxLines = 2) }
    }
}

/** A badge as a medal: lit when earned, a lock when not. */
@Composable
fun MedalTile(name: String, earned: Boolean, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(16.dp)
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(
            Modifier.size(52.dp).clip(shape).background(if (earned) C.signal.copy(alpha = .16f) else Color.Black.copy(alpha = .28f))
                .border(1.dp, if (earned) C.signal.copy(alpha = .55f) else C.hair, shape),
            contentAlignment = Alignment.Center,
        ) { Ico(if (earned) "medal" else "lock", color = if (earned) C.signalHi else C.g600, size = 24.dp) }
        Txt(name, T.Micro, FontWeight.Medium, if (earned) C.g100 else C.g500, align = TextAlign.Center, maxLines = 2)
    }
}

/** A part of the product that is not open yet: a dimmed row with a lock and what opens it, instead of a full card of text. */
@Composable
fun LockedStage(icon: String, title: String, hint: String, progress: String? = null, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().plate(16.dp).alpha(.82f).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(Color.Black.copy(alpha = .3f)), contentAlignment = Alignment.Center) { Ico(icon, color = C.g500, size = 20.dp) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Txt(title, T.Body, FontWeight.ExtraBold, C.g300, maxLines = 1)
            Txt(hint, T.Small - 1, color = C.g500, maxLines = 2)
        }
        progress?.let { Chip(it, Tone.Neutral) }
        Ico("lock", color = C.g600, size = 16.dp)
    }
}

/** The bottom of a full-screen flow: a hairline and the actions, where the thumb is. */
@Composable
fun ActionDock(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(C.hair))
        Spacer(Modifier.height(0.dp))
        content()
    }
}
