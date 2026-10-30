package space.affinix.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/** The app link the browser comes back to (declared in the manifest) and the activity that hands it over. */
object AndroidAuth {
    const val REDIRECT = "space.affinix.app://auth"
    internal var context: Context? = null
    private var waiting: CompletableDeferred<Map<String, String>?>? = null

    internal fun begin(): CompletableDeferred<Map<String, String>?> = CompletableDeferred<Map<String, String>?>().also { waiting?.complete(null); waiting = it }

    /** called by the activity with the address the browser opened the app with */
    fun deliver(uri: Uri?) {
        if (uri == null || uri.scheme != "space.affinix.app") return
        val params = HashMap<String, String>()
        for (name in uri.queryParameterNames) uri.getQueryParameter(name)?.let { params[name] = it }
        waiting?.complete(params)
        waiting = null
    }
}

actual object Browser {
    actual suspend fun authorize(urlFor: (redirect: String) -> String): Map<String, String>? {
        val ctx = AndroidAuth.context ?: return null
        val back = AndroidAuth.begin()
        try {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(urlFor(AndroidAuth.REDIRECT))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) { return null }
        return withTimeoutOrNull(180_000) { back.await() }
    }

    actual fun openUrl(url: String): Boolean {
        val ctx = AndroidAuth.context ?: return false
        return try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (e: Exception) { false }
    }
}
