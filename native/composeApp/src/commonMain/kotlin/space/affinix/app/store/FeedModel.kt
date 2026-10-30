package space.affinix.app.store

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import io.ktor.http.HttpMethod
import space.affinix.app.net.Api
import space.affinix.app.net.AuthorRow
import space.affinix.app.net.Comment
import space.affinix.app.net.CommentRow
import space.affinix.app.net.Person
import space.affinix.app.net.Post
import space.affinix.app.net.PostIdRow
import space.affinix.app.net.PostRow
import space.affinix.app.net.toPerson

/** Posts, likes, saves and comments: the website's Feed (src/lib/postsStore.js + postInteractions.js) over the same tables. */
class FeedModel(private val api: Api, private val scope: CoroutineScope, private val me: () -> String?) {
    var posts by mutableStateOf<List<Post>>(emptyList())
        private set
    var loaded by mutableStateOf(false)
        private set
    var loading by mutableStateOf(false)
        private set
    var loadingMore by mutableStateOf(false)
        private set
    var hasMore by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    /** 0 = everyone, 1 = my own posts, 2 = the posts I saved */
    var mode by mutableStateOf(0)
        private set
    val mineOnly get() = mode == 1

    /** a short message for the player: a key of the strings table, shown once */
    var notice by mutableStateOf<String?>(null)
    var openComments by mutableStateOf<Set<String>>(emptySet())
        private set
    var comments by mutableStateOf<Map<String, List<Comment>>>(emptyMap())
        private set
    var commentsLoading by mutableStateOf<Set<String>>(emptySet())
        private set

    private fun say(key: String) { notice = key; scope.launch { delay(3500); if (notice == key) notice = null } }

    fun showMode(m: Int) { if (mode != m) { mode = m; load() } }

    // ---- reading --------------------------------------------------------------------------------------------------------------------

    suspend fun authors(ids: Collection<String>): Map<String, Person> {
        val unique = ids.toSet().toList()
        if (unique.isEmpty()) return emptyMap()
        val rows = api.restGet(
            "profiles_public", ListSerializer(AuthorRow.serializer()),
            "select" to "id,full_name,username,avatar_url,role_title,bio", "id" to "in.(${unique.joinToString(",")})",
        )
        return rows.associate { it.id to it.toPerson() }
    }

    private suspend fun viewerIds(table: String, postIds: List<String>): Set<String> {
        val uid = me() ?: return emptySet()
        if (postIds.isEmpty()) return emptySet()
        return api.restGet(table, ListSerializer(PostIdRow.serializer()), "select" to "post_id", "user_id" to "eq.$uid", "post_id" to "in.(${postIds.joinToString(",")})")
            .map { it.postId }.toSet()
    }

    internal suspend fun page(before: String?): List<Post> {
        if (mode == 2) return savedPage()
        val q = mutableListOf("select" to "*,post_likes(count),post_comments(count)", "order" to "created_at.desc", "limit" to PAGE.toString())
        if (before != null) q += "created_at" to "lt.$before"
        if (mineOnly) me()?.let { q += "author_id" to "eq.$it" }
        val rows = api.restGet("posts", ListSerializer(PostRow.serializer()), *q.toTypedArray())
        val ids = rows.map { it.id }
        val authors = authors(rows.map { it.authorId })
        val liked = viewerIds("post_likes", ids)
        val saved = viewerIds("post_saves", ids)
        return rows.map { r ->
            Post(
                r.id, authors[r.authorId] ?: Person(r.authorId, null, null, null), r.body, r.imageUrl, r.createdAt, r.updatedAt != null && r.updatedAt != r.createdAt,
                r.postLikes.firstOrNull()?.count ?: 0, r.postComments.firstOrNull()?.count ?: 0, r.id in liked, r.id in saved,
            )
        }
    }

    /** the posts the viewer saved, newest save first (the website's Favorites page) */
    private suspend fun savedPage(): List<Post> {
        val uid = me() ?: return emptyList()
        val saves = api.restGet("post_saves", ListSerializer(PostIdRow.serializer()), "select" to "post_id", "user_id" to "eq.$uid", "order" to "created_at.desc", "limit" to "100")
        if (saves.isEmpty()) return emptyList()
        val ids = saves.map { it.postId }
        val rows = api.restGet("posts", ListSerializer(PostRow.serializer()), "select" to "*,post_likes(count),post_comments(count)", "id" to "in.(${ids.joinToString(",")})")
        val authors = authors(rows.map { it.authorId })
        val liked = viewerIds("post_likes", ids)
        val byId = rows.associateBy { it.id }
        return ids.mapNotNull { byId[it] }.map { r ->
            Post(r.id, authors[r.authorId] ?: Person(r.authorId, null, null, null), r.body, r.imageUrl, r.createdAt, r.updatedAt != null && r.updatedAt != r.createdAt,
                r.postLikes.firstOrNull()?.count ?: 0, r.postComments.firstOrNull()?.count ?: 0, r.id in liked, true)
        }
    }

    fun load() { scope.launch { loadNow() } }

    internal suspend fun loadNow() {
        loading = true; failed = false
        try {
            val p = page(null)
            posts = p; hasMore = mode != 2 && p.size >= PAGE; loaded = true
        } catch (e: CancellationException) { throw e } catch (e: Exception) { failed = true } finally { loading = false }
    }

    fun loadMore() {
        val last = posts.lastOrNull() ?: return
        if (loadingMore || !hasMore) return
        scope.launch {
            loadingMore = true
            try {
                val p = page(last.createdAt)
                val have = posts.map { it.id }.toSet()
                posts = posts + p.filter { it.id !in have }; hasMore = p.size >= PAGE
            } catch (e: CancellationException) { throw e } catch (e: Exception) { say("feed.loadMoreFailed") } finally { loadingMore = false }
        }
    }

    private fun patch(id: String, f: (Post) -> Post) { posts = posts.map { if (it.id == id) f(it) else it } }

    // ---- writing --------------------------------------------------------------------------------------------------------------------

    /** Returns null when published, or the string key to show (refused, or the server said no). */
    suspend fun publish(text: String, image: space.affinix.app.ShrunkImage? = null): String? {
        val t = text.trim()
        if (t.isEmpty()) return null
        val v = Moderation.moderate(t)
        if (v.action == Moderation.Action.Block) return "feed.profanityBlocked"
        var uploaded: String? = null
        return try {
            var imageUrl: String? = null
            val uid = me()
            if (image != null && uid != null) {
                val path = "$uid/${space.affinix.app.Platform.uuid()}.${image.ext}"
                api.uploadObject(POST_BUCKET, path, image.bytes, image.mime)
                uploaded = path
                imageUrl = api.publicObjectUrl(POST_BUCKET, path)
            }
            api.restWrite(HttpMethod.Post, "posts", body = buildJsonObject { put("body", v.text); if (imageUrl != null) put("image_url", imageUrl) })
            if (v.action == Moderation.Action.Censor) say("feed.postedCensored") else say("feed.posted")
            load()
            null
        } catch (e: CancellationException) { throw e } catch (e: Exception) {
            uploaded?.let { path -> runCatching { api.removeObjects(POST_BUCKET, listOf(path)) } } // the post did not happen: do not keep its picture
            "app.noNetwork"
        }
    }

    fun delete(p: Post) {
        scope.launch {
            val before = posts
            posts = posts.filter { it.id != p.id }
            try {
                api.restWrite(HttpMethod.Delete, "posts", listOf("id" to "eq.${p.id}")); say("feed.postDeleted")
                api.pathFromPublicUrl(POST_BUCKET, p.imageUrl)?.takeIf { it.startsWith("${me()}/") }?.let { path -> runCatching { api.removeObjects(POST_BUCKET, listOf(path)) } }
            }
            catch (e: CancellationException) { throw e } catch (e: Exception) { posts = before; say("app.noNetwork") }
        }
    }

    fun toggleLike(p: Post) {
        val flip = !p.liked
        patch(p.id) { it.copy(liked = flip, likes = (it.likes + if (flip) 1 else -1).coerceAtLeast(0)) }
        scope.launch {
            try {
                if (flip) api.restWrite(HttpMethod.Post, "post_likes", body = buildJsonObject { put("post_id", p.id) })
                else api.restWrite(HttpMethod.Delete, "post_likes", listOf("post_id" to "eq.${p.id}", "user_id" to "eq.${me().orEmpty()}"))
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                patch(p.id) { it.copy(liked = p.liked, likes = p.likes) }; say("app.noNetwork")
            }
        }
    }

    fun toggleSave(p: Post) {
        val flip = !p.saved
        patch(p.id) { it.copy(saved = flip) }
        scope.launch {
            try {
                if (flip) api.restWrite(HttpMethod.Post, "post_saves", body = buildJsonObject { put("post_id", p.id) })
                else api.restWrite(HttpMethod.Delete, "post_saves", listOf("post_id" to "eq.${p.id}", "user_id" to "eq.${me().orEmpty()}"))
            } catch (e: CancellationException) { throw e } catch (e: Exception) { patch(p.id) { it.copy(saved = p.saved) }; say("app.noNetwork") }
        }
    }

    // ---- comments -------------------------------------------------------------------------------------------------------------------

    fun toggleComments(p: Post) {
        if (p.id in openComments) { openComments = openComments - p.id; return }
        openComments = openComments + p.id
        loadComments(p.id)
    }

    private fun loadComments(postId: String) {
        scope.launch {
            commentsLoading = commentsLoading + postId
            try {
                val rows = api.restGet("post_comments", ListSerializer(CommentRow.serializer()), "select" to "*", "post_id" to "eq.$postId", "order" to "created_at.asc")
                val a = authors(rows.map { it.authorId })
                comments = comments + (postId to rows.map { Comment(it.id, it.postId, a[it.authorId] ?: Person(it.authorId, null, null, null), it.body, it.createdAt) })
            } catch (e: CancellationException) { throw e } catch (e: Exception) { say("app.noNetwork") } finally { commentsLoading = commentsLoading - postId }
        }
    }

    suspend fun comment(p: Post, text: String): String? {
        val t = text.trim()
        if (t.isEmpty()) return null
        val v = Moderation.moderate(t)
        if (v.action == Moderation.Action.Block) return "feed.profanityBlocked"
        return try {
            val written = api.restWrite(HttpMethod.Post, "post_comments", body = buildJsonObject { put("post_id", p.id); put("body", v.text) }, returning = true)
            val id = Regex("\"id\"\\s*:\\s*\"([^\"]+)\"").find(written)?.groupValues?.get(1)
            val uid = me()
            // the post's author is told; a failure here never undoes the comment
            if (id != null && uid != null && uid != p.author.id) runCatching {
                api.restWrite(HttpMethod.Post, "notifications", body = buildJsonObject { put("recipient_id", p.author.id); put("post_id", p.id); put("comment_id", id) })
            }
            patch(p.id) { it.copy(comments = it.comments + 1) }
            if (v.action == Moderation.Action.Censor) say("feed.commentPostedCensored")
            loadComments(p.id)
            null
        } catch (e: CancellationException) { throw e } catch (e: Exception) { "app.noNetwork" }
    }

    fun deleteComment(c: Comment) {
        scope.launch {
            val before = comments
            comments = comments + (c.postId to (comments[c.postId].orEmpty().filter { it.id != c.id }))
            try {
                api.restWrite(HttpMethod.Delete, "post_comments", listOf("id" to "eq.${c.id}"))
                patch(c.postId) { it.copy(comments = (it.comments - 1).coerceAtLeast(0)) }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { comments = before; say("app.noNetwork") }
        }
    }

    companion object { const val PAGE = 30; const val POST_BUCKET = "post-images" }
}
