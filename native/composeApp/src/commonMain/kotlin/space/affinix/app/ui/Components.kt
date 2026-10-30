package space.affinix.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import space.affinix.app.i18n.Lang

@Composable
fun Txt(
    text: String,
    size: Int = 14,
    weight: FontWeight = FontWeight.Normal,
    color: Color = C.g100,
    modifier: Modifier = Modifier,
    align: TextAlign = TextAlign.Unspecified,
    maxLines: Int = Int.MAX_VALUE,
    spacing: Float = 0f,
) {
    BasicText(
        text,
        modifier,
        style = ts(size, weight, color, LocalFonts.current.family, spacing).copy(textAlign = align),
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

/** A raised key. [lit] is the one orange primary action of a screen. */
@Composable
fun KeyButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, lit: Boolean = false, enabled: Boolean = true, big: Boolean = false, compact: Boolean = false) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val hovered by src.collectIsHoveredAsState()
    Box(
        modifier
            .alpha(if (enabled) 1f else .45f)
            .then(if (lit) Modifier.lit(12.dp, pressed) else Modifier.key(12.dp, pressed, hovered))
            .hoverable(src)
            .clickable(src, null, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = if (compact) 8.dp else 18.dp, vertical = if (big) 15.dp else 11.dp),
        contentAlignment = Alignment.Center,
    ) { Txt(text, if (compact) 13 else 15, FontWeight.Bold, if (lit) C.signalInk else C.g100, align = TextAlign.Center, maxLines = 1) }
}

/** A text-only action (links under a form). */
@Composable
fun LinkText(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = C.g300) {
    val src = remember { MutableInteractionSource() }
    val hovered by src.collectIsHoveredAsState()
    Txt(text, 14, FontWeight.Medium, if (hovered) C.g50 else color, modifier.hoverable(src).clickable(src, null, role = Role.Button, onClick = onClick).padding(vertical = 6.dp))
}

@Composable
fun Plate(modifier: Modifier = Modifier, radius: Int = 16, pad: Int = 18, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.plate(radius.dp).padding(pad.dp), content = content)
}

@Composable
fun Well(modifier: Modifier = Modifier, radius: Int = 14, content: @Composable BoxScope.() -> Unit) {
    Box(modifier.well(radius.dp).clip(RoundedCornerShape(radius.dp)), content = content)
}

@Composable
fun Bar(ratio: Float, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(8.dp).well(6.dp)) {
        val r = ratio.coerceIn(0f, 1f)
        if (r > 0f) Box(Modifier.fillMaxWidth(r).height(8.dp).lit(6.dp))
    }
}

enum class Tone { Neutral, Ok, Warn, Bad, Info, Signal }

@Composable
fun Chip(text: String, tone: Tone = Tone.Neutral, modifier: Modifier = Modifier) {
    val c = when (tone) {
        Tone.Neutral -> C.g300; Tone.Ok -> C.ok; Tone.Warn -> C.warn; Tone.Bad -> C.bad; Tone.Info -> C.info; Tone.Signal -> C.signalHi
    }
    Box(
        modifier.clip(Pill).background(c.copy(alpha = .13f)).border(1.dp, c.copy(alpha = .38f), Pill).padding(horizontal = 10.dp, vertical = 4.dp),
        contentAlignment = Alignment.Center,
    ) { Txt(text, 12, FontWeight.Bold, c, maxLines = 1) }
}

@Composable
fun Field(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    password: Boolean = false,
    email: Boolean = false,
    imeDone: Boolean = true,
    onDone: () -> Unit = {},
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Txt(label, 12, FontWeight.Medium, C.g400)
        BasicTextField(
            value, onChange,
            singleLine = true,
            textStyle = ts(15, FontWeight.Medium, C.g50, LocalFonts.current.family),
            cursorBrush = SolidColor(C.signal),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else if (email) KeyboardType.Email else KeyboardType.Text, imeAction = if (imeDone) ImeAction.Done else ImeAction.Next),
            keyboardActions = KeyboardActions(onDone = { onDone() }),
            modifier = Modifier.fillMaxWidth().well(12.dp).padding(horizontal = 14.dp, vertical = 13.dp),
        )
    }
}

@Composable
fun LangSwitch(current: Lang, onPick: (Lang) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (l in Lang.entries) KeyButton(l.label, { onPick(l) }, Modifier.weight(1f), lit = l == current, compact = true)
    }
}

/** A two- or three-way segmented control; the selected key sits "pressed in". */
@Composable
fun Segmented(labels: List<String>, selected: Int, onPick: (Int) -> Unit, modifier: Modifier = Modifier) {
    // up to three labels share the row; with more the labels keep their own width and the row scrolls sideways, so none is cut off
    val scrolls = labels.size >= 4
    Row(
        modifier.fillMaxWidth().well(14.dp).then(if (scrolls) Modifier.horizontalScroll(rememberScrollState()) else Modifier).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        labels.forEachIndexed { i, label ->
            val on = i == selected
            Box(
                (if (scrolls) Modifier else Modifier.weight(1f)).then(if (on) Modifier.key(10.dp, down = false) else Modifier)
                    .clickable(remember { MutableInteractionSource() }, null, role = Role.Tab) { onPick(i) }.padding(vertical = 10.dp, horizontal = if (scrolls) 14.dp else 0.dp),
                contentAlignment = Alignment.Center,
            ) { Txt(label, 14, if (on) FontWeight.Bold else FontWeight.Medium, if (on) C.g50 else C.g400, maxLines = 1) }
        }
    }
}

/** An on/off switch: a sunken track with a key-like knob that lights orange when on. */
@Composable
fun Toggle(on: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.size(width = 52.dp, height = 30.dp).then(if (on) Modifier.lit(15.dp) else Modifier.well(15.dp))
            .clickable(remember { MutableInteractionSource() }, null, role = Role.Switch) { onChange(!on) }.padding(3.dp),
        contentAlignment = if (on) Alignment.CenterEnd else Alignment.CenterStart,
    ) { Box(Modifier.size(24.dp).then(if (on) Modifier.key(12.dp) else Modifier.key(12.dp, hover = false))) }
}
