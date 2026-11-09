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

    actual fun shareText(text: String): Boolean {
        val ctx = AndroidAuth.context ?: return false
        return try {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            ctx.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (e: Exception) { false }
    }

    actual fun openUrl(url: String): Boolean {
        val ctx = AndroidAuth.context ?: return false
        return try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (e: Exception) { false }
    }
}

/** A Taste Match link that opened the app from outside (a message, a browser): handed to the app model as soon as there is one. */
object AndroidChallenge {
    internal var onLink: ((String) -> Unit)? = null
    private var pending: String? = null

    /** called by the activity with the address it was opened with: only affinix.space addresses that carry a `c` value count */
    fun deliver(uri: Uri?) {
        if (uri == null || uri.scheme != "https" || uri.host != "affinix.space") return
        val c = uri.getQueryParameter("c") ?: return
        val listener = onLink
        if (listener != null) listener(c) else pending = c
    }

    internal fun takePending(): String? = pending.also { pending = null }
}
