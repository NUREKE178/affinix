package space.affinix.app

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.font.FontWeight
import org.jetbrains.compose.resources.painterResource
import space.affinix.app.res.Res
import space.affinix.app.res.logo
import space.affinix.app.ui.C
import space.affinix.app.ui.LocalFonts
import space.affinix.app.ui.lit
import space.affinix.app.ui.plate
import space.affinix.app.ui.rememberFonts
import space.affinix.app.ui.ts

@Composable
fun App() {
    val fonts = rememberFonts()
    CompositionLocalProvider(LocalFonts provides fonts) {
        Box(Modifier.fillMaxSize().background(C.canvas), contentAlignment = Alignment.Center) {
            Column(
                Modifier.widthIn(max = 420.dp).plate(20.dp).padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Image(painterResource(Res.drawable.logo), null, Modifier.size(72.dp))
                BasicText("Affinix", style = ts(28, FontWeight.ExtraBold, C.g50, fonts.family))
                BasicText("Қазақша · Русский · English", style = ts(14, FontWeight.Medium, C.g400, fonts.family))
                Spacer(Modifier.height(4.dp))
                Box(Modifier.width(220.dp).lit(12.dp).padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                    BasicText("Start", style = ts(15, FontWeight.Bold, C.signalInk, fonts.family))
                }
            }
        }
    }
}
