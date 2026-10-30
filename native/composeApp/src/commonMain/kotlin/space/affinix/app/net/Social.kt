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
