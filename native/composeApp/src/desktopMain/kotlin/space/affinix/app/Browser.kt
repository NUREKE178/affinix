package space.affinix.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.net.URLDecoder

actual object Browser {
    private const val WAIT_MS = 180_000L

    /** the page the browser lands on after Google: the code is read from the address and the player is told to go back to the app */
    private const val DONE_PAGE = "<!doctype html><meta charset=utf-8><title>Affinix</title><body style=\"font-family:sans-serif;background:#16171a;color:#e8e9ec;text-align:center;padding-top:20vh\"><h2>Affinix</h2><p>You can close this tab and go back to the app.<br>Можно закрыть вкладку и вернуться в приложение.</p></body>"

    actual suspend fun authorize(urlFor: (redirect: String) -> String): Map<String, String>? = withContext(Dispatchers.IO) {
        ServerSocket(0, 4, InetAddress.getLoopbackAddress()).use { server ->
            server.soTimeout = 1000
            val redirect = "http://127.0.0.1:${server.localPort}/callback"
            if (!opener(urlFor(redirect))) return@withContext null
            val until = System.currentTimeMillis() + WAIT_MS
            while (System.currentTimeMillis() < until) {
                currentCoroutineContext().ensureActive()
                val socket = try { server.accept() } catch (e: SocketTimeoutException) { continue }
                socket.use { s ->
                    s.soTimeout = 3000
                    val line = runCatching { s.getInputStream().bufferedReader().readLine() }.getOrNull().orEmpty() // "GET /callback?code=... HTTP/1.1"
                    val target = line.split(" ").getOrNull(1).orEmpty()
                    val ok = target.startsWith("/callback")
                    val body = if (ok) DONE_PAGE else ""
                    val bytes = body.toByteArray(Charsets.UTF_8)
                    s.getOutputStream().apply {
                        write("HTTP/1.1 ${if (ok) "200 OK" else "404 Not Found"}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        write(bytes); flush()
                    }
                    if (ok) return@withContext query(target)
                }
            }
            null
        }
    }

    actual fun openUrl(url: String): Boolean = open(url)

    /** how the page is shown; tests replace it with a fake browser */
    internal var opener: (String) -> Boolean = ::open

    internal fun query(target: String): Map<String, String> =
        target.substringAfter('?', "").split('&').filter { it.isNotEmpty() }.associate {
            URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
        }

    private fun open(url: String): Boolean {
        return try {
            if (java.awt.Desktop.isDesktopSupported() && java.awt.Desktop.getDesktop().isSupported(java.awt.Desktop.Action.BROWSE)) { java.awt.Desktop.getDesktop().browse(java.net.URI(url)); true }
            else {
                val os = System.getProperty("os.name").lowercase()
                val cmd = if (os.contains("win")) arrayOf("rundll32", "url.dll,FileProtocolHandler", url) else if (os.contains("mac")) arrayOf("open", url) else arrayOf("xdg-open", url)
                ProcessBuilder(*cmd).start(); true
            }
        } catch (e: Exception) { false }
    }
}
