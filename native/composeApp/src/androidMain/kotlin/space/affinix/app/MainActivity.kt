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
        // the system's picture chooser (posts, chat, avatar): registered before the activity starts, as the platform requires
        val pickImage = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.GetContent()) { uri -> AndroidImages.deliver(uri) }
        AndroidImages.context = applicationContext
        AndroidAuth.context = applicationContext
        AndroidAuth.deliver(intent?.data)
        AndroidImages.launch = { pickImage.launch("image/*") }
        val kv = PrefsKeyValueStore(applicationContext)
        setContent {
            val scope = rememberCoroutineScope()
            val model = remember { AppModel(Api(httpClient(), Config(), StoredSession(kv)), scope, kv) }
            val round by model.game.round.collectAsState()
            // Back leaves a round first, then goes back to the Play tab; only from there does it close the app.
            BackHandler(enabled = model.signedIn && (round != null || model.mission.round != null || model.messages.open != null || model.tab != Tab.Play)) {
                when {
                    round != null -> model.endRound()
                    model.mission.round != null -> model.mission.end()
                    model.tab == Tab.Chats && model.messages.open != null -> model.messages.closeChat()
                    else -> model.tab = Tab.Play
                }
            }
            App(model)
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        AndroidAuth.deliver(intent.data) // the browser coming back from Google
    }

    override fun onDestroy() {
        AndroidImages.launch = null
        super.onDestroy()
    }
}
