package space.affinix.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import space.affinix.app.net.Api
import space.affinix.app.net.Config
import space.affinix.app.net.StoredSession
import space.affinix.app.net.httpClient
import space.affinix.app.store.AppModel
import space.affinix.app.store.Tab

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val kv = PrefsKeyValueStore(applicationContext)
        setContent {
            val scope = rememberCoroutineScope()
            val model = remember { AppModel(Api(httpClient(), Config(), StoredSession(kv)), scope, kv) }
            val round by model.game.round.collectAsState()
            // Back leaves a round first, then goes back to the Play tab; only from there does it close the app.
            BackHandler(enabled = model.signedIn && (round != null || model.tab != Tab.Play)) {
                if (round != null) model.endRound() else model.tab = Tab.Play
            }
            App(model)
        }
    }
}
