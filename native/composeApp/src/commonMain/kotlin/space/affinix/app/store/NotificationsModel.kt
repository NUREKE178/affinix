package space.affinix.app.store

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.ktor.http.HttpMethod
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import space.affinix.app.net.Api
import space.affinix.app.net.Notice
import space.affinix.app.net.NotificationRow
import space.affinix.app.net.Person

/** The bell: comments on my posts and friend events (src/lib/notificationsStore.js). */
class NotificationsModel(private val api: Api, private val scope: CoroutineScope, private val me: () -> String?, private val feed: FeedModel) {
    var items by mutableStateOf<List<Notice>>(emptyList())
        private set
    var loaded by mutableStateOf(false)
        private set
    val unread: Int get() = items.count { !it.read }

    fun refresh() { scope.launch { refreshNow() } }

    internal suspend fun refreshNow() {
        val uid = me() ?: return
        try {
            val rows = api.restGet(
                "notifications", ListSerializer(NotificationRow.serializer()),
                "select" to "*,comment:post_comments(body)", "recipient_id" to "eq.$uid", "order" to "created_at.desc", "limit" to "30",
            )
            val actors = feed.authors(rows.mapNotNull { it.actorId })
            items = rows.map { Notice(it.id, it.type ?: "comment", actors[it.actorId] ?: Person(it.actorId.orEmpty(), null, null, null), it.comment?.body, it.isRead, it.createdAt) }
            loaded = true
        } catch (e: CancellationException) { throw e } catch (e: Exception) { /* the bell just keeps what it had */ }
    }

    fun markAllRead() {
        val uid = me() ?: return
        items = items.map { it.copy(read = true) }
        scope.launch {
            try { api.restWrite(HttpMethod.Patch, "notifications", listOf("recipient_id" to "eq.$uid", "is_read" to "eq.false"), buildJsonObject { put("is_read", JsonPrimitive(true)) }) }
            catch (e: CancellationException) { throw e } catch (e: Exception) { refresh() }
        }
    }

    /** one strings key per kind, the same three as the website */
    fun copyKey(type: String) = when (type) {
        "friend_request" -> "shell.notifications.friendRequest"
        "friend_accept" -> "shell.notifications.friendAccepted"
        else -> "shell.notifications.commentOn"
    }
}
