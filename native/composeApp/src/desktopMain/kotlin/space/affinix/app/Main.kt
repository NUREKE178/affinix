package space.affinix.app

import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowState
import androidx.compose.ui.window.application
import org.jetbrains.compose.resources.painterResource
import space.affinix.app.net.Api
import space.affinix.app.net.Config
import space.affinix.app.net.StoredSession
import space.affinix.app.net.httpClient
import space.affinix.app.res.Res
import space.affinix.app.res.logo
import space.affinix.app.store.AppModel

fun main() = application {
    val scope = rememberCoroutineScope()
    val model = remember {
        val kv = FileKeyValueStore.default()
        AppModel(Api(httpClient(), Config(), StoredSession(kv)), scope, kv)
    }
    Window(
        onCloseRequest = ::exitApplication,
        title = "Affinix",
        icon = painterResource(Res.drawable.logo),
        state = WindowState(width = 1000.dp, height = 780.dp),
    ) { App(model) }
}
