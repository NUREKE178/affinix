package space.affinix.app.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Row shapes of the website's tables (PostgREST). Only the columns the app reads. */
@Serializable
data class AuthorRow(
    val id: String,
    @SerialName("full_name") val fullName: String? = null,
    val username: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null,
    @SerialName("role_title") val roleTitle: String? = null,
    val bio: String? = null,
)

@Serializable
data class CountRow(val count: Int = 0)

@Serializable
data class PostRow(
    val id: String,
    @SerialName("author_id") val authorId: String,
    val body: String = "",
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("post_likes") val postLikes: List<CountRow> = emptyList(),
    @SerialName("post_comments") val postComments: List<CountRow> = emptyList(),
)

@Serializable
data class PostIdRow(@SerialName("post_id") val postId: String)

@Serializable
data class CommentRow(
    val id: String,
    @SerialName("post_id") val postId: String,
    @SerialName("author_id") val authorId: String,
    val body: String = "",
    @SerialName("created_at") val createdAt: String = "",
)

/** What the screens show. */
data class Person(val id: String, val name: String?, val username: String?, val avatarUrl: String?, val roleTitle: String? = null, val bio: String? = null)

data class Post(
    val id: String,
    val author: Person,
    val body: String,
    val imageUrl: String?,
    val createdAt: String,
    val edited: Boolean,
    val likes: Int,
    val comments: Int,
    val liked: Boolean,
    val saved: Boolean,
)

data class Comment(val id: String, val postId: String, val author: Person, val body: String, val createdAt: String)

fun AuthorRow.toPerson() = Person(id, fullName, username, avatarUrl, roleTitle, bio)

@Serializable
data class FriendshipRow(
    val id: String,
    @SerialName("requester_id") val requesterId: String,
    @SerialName("addressee_id") val addresseeId: String,
    val status: String = "",
    @SerialName("created_at") val createdAt: String = "",
)

/** One friendship as the viewer sees it. */
data class Friendship(val id: String, val other: Person, val status: String, val iRequested: Boolean, val createdAt: String) {
    val accepted get() = status == "accepted"
}

@Serializable
data class ConversationRow(
    val id: String,
    @SerialName("user_a") val userA: String,
    @SerialName("user_b") val userB: String,
    @SerialName("last_message_body") val lastBody: String? = null,
    @SerialName("last_message_at") val lastAt: String? = null,
    @SerialName("last_message_sender_id") val lastSender: String? = null,
    @SerialName("last_message_has_attachment") val lastHasImage: Boolean = false,
    @SerialName("last_message_deleted") val lastDeleted: Boolean = false,
)

@Serializable
data class UnreadRow(@SerialName("conversation_id") val conversationId: String, val unread: kotlinx.serialization.json.JsonPrimitive? = null)

@Serializable
data class MessageRow(
    val id: String,
    @SerialName("conversation_id") val conversationId: String,
    @SerialName("sender_id") val senderId: String,
    val body: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("read_at") val readAt: String? = null,
    @SerialName("edited_at") val editedAt: String? = null,
    @SerialName("deleted_at") val deletedAt: String? = null,
    @SerialName("attachment_path") val attachmentPath: String? = null,
    @SerialName("reply_to_id") val replyToId: String? = null,
    val reactions: List<ReactionRow> = emptyList(),
    val reply: ReplyRow? = null,
)

@Serializable
data class ReactionRow(@SerialName("user_id") val userId: String, val emoji: String)

@Serializable
data class ReplyRow(
    val id: String,
    @SerialName("sender_id") val senderId: String,
    val body: String? = null,
    @SerialName("attachment_path") val attachmentPath: String? = null,
    @SerialName("deleted_at") val deletedAt: String? = null,
)

@Serializable
data class PrefRow(@SerialName("conversation_id") val conversationId: String, @SerialName("pinned_at") val pinnedAt: String? = null, val muted: Boolean = false)

@Serializable
data class FoundMessageRow(
    @SerialName("message_id") val messageId: String,
    @SerialName("conversation_id") val conversationId: String,
    @SerialName("sender_id") val senderId: String,
    val body: String = "",
    @SerialName("created_at") val createdAt: String = "",
)

/** The message a reply points at (null body and image = it was deleted). */
data class Quote(val id: String, val senderId: String, val text: String, val hasImage: Boolean, val deleted: Boolean)

data class Reaction(val userId: String, val emoji: String)

data class Conversation(
    val id: String, val other: Person, val lastBody: String?, val lastAt: String?, val lastSender: String?,
    val lastHasImage: Boolean, val lastDeleted: Boolean, val unread: Long,
    val pinned: Boolean = false, val muted: Boolean = false,
)

data class Message(
    val id: String, val conversationId: String, val senderId: String, val body: String, val createdAt: String,
    val read: Boolean, val edited: Boolean, val deleted: Boolean, val hasImage: Boolean,
    val reactions: List<Reaction> = emptyList(), val reply: Quote? = null, val replyToId: String? = null,
    /** null = confirmed by the server; "sending" or "failed" = only on this device so far */
    val status: String? = null,
)

@Serializable
data class CommentBodyRow(val body: String? = null)

@Serializable
data class NotificationRow(
    val id: String,
    val type: String? = null,
    @SerialName("post_id") val postId: String? = null,
    @SerialName("actor_id") val actorId: String? = null,
    @SerialName("is_read") val isRead: Boolean = false,
    @SerialName("created_at") val createdAt: String = "",
    val comment: CommentBodyRow? = null,
)

data class Notice(val id: String, val type: String, val actor: Person, val commentBody: String?, val read: Boolean, val createdAt: String)
