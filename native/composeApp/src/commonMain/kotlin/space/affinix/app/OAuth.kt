package space.affinix.app

import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/** Opens a page in the system browser and waits for the browser to come back to the app (sign-in with Google). */
expect object Browser {
    /**
     * [urlFor] builds the page to open for the redirect address the platform chose (a loopback address on a computer, an app link on a phone).
     * Returns the query parameters of the redirect, or null when nothing came back in time or the player gave up.
     */
    suspend fun authorize(urlFor: (redirect: String) -> String): Map<String, String>?

    /** Shows a web page in the system browser (the download page, for an update). */
    fun openUrl(url: String): Boolean
}

/** PKCE (RFC 7636): the app proves it is the one that started the sign-in without keeping a secret. */
@OptIn(ExperimentalEncodingApi::class)
object Pkce {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"

    fun verifier(): String = Platform.randomBytes(64).joinToString("") { ALPHABET[(it.toInt() and 0xFF) % ALPHABET.length].toString() }

    /** base64url(sha256(verifier)) without padding */
    fun challenge(verifier: String): String = Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT).encode(Platform.sha256(verifier.encodeToByteArray()))
}
