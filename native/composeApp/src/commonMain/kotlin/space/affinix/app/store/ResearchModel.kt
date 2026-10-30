package space.affinix.app.store

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.ktor.http.HttpMethod
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import space.affinix.app.Platform
import space.affinix.app.net.Api
import space.affinix.app.net.ApiException
import space.affinix.app.net.Experiment
import space.affinix.app.net.ExperimentRow
import space.affinix.app.net.MemberOrgRow
import space.affinix.app.net.Org
import space.affinix.app.net.ParticipantSession
import space.affinix.app.net.SessionRow
import space.affinix.app.net.toExperiment
import space.affinix.app.net.toSession

@Serializable
data class MemberProfile(@SerialName("full_name") val fullName: String? = null, val email: String? = null, @SerialName("avatar_url") val avatarUrl: String? = null)

@Serializable
data class MemberRow(val id: String, val role: String = "viewer", @SerialName("user_id") val userId: String = "", @SerialName("created_at") val createdAt: String? = null, val profile: MemberProfile? = null)

data class Member(val id: String, val userId: String, val role: String, val joinedAt: String?, val name: String, val email: String, val avatarUrl: String?)

/**
 * The marketers' side of the product (the website's Research, Participants and Team pages) over the same tables: the company the person belongs to, its experiments with
 * their results, the participants and the team. Experiments are built on the website; the app reads them, publishes a draft and deletes.
 */
class ResearchModel(private val api: Api, private val scope: CoroutineScope, private val me: () -> String?) {
    enum class Section { Experiments, Participants, Crowd, Team }

    var section by mutableStateOf(Section.Experiments)

    // ---- companies ---------------------------------------------------------------------------------------------------------------
    var orgs by mutableStateOf<List<Org>>(emptyList())
        private set
    var orgsLoaded by mutableStateOf(false)
        private set
    var orgsFailed by mutableStateOf(false)
        private set
    var activeOrgId by mutableStateOf<String?>(null)
        private set
    val org: Org? get() = orgs.firstOrNull { it.id == activeOrgId }
    val canManage: Boolean get() = org?.role in setOf("owner", "admin")

    fun loadOrgs() {
        val uid = me() ?: return
        scope.launch {
            try {
                val rows = api.restGet("organization_members", ListSerializer(MemberOrgRow.serializer()), "select" to "role,organization:organizations(id,name,slug)", "user_id" to "eq.$uid")
                orgs = rows.mapNotNull { r -> r.organization?.let { Org(it.id, it.name, r.role) } }
                if (activeOrgId == null || orgs.none { it.id == activeOrgId }) activeOrgId = orgs.firstOrNull()?.id
                orgsLoaded = true; orgsFailed = false
                activeOrgId?.let { loadExperiments(); }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { orgsFailed = true; orgsLoaded = true }
        }
    }

    fun pickOrg(id: String) { if (id == activeOrgId) return; activeOrgId = id; experiments = emptyList(); members = emptyList(); orgSessions = emptyList(); closeExperiment(); loadExperiments() }

    // ---- experiments ---------------------------------------------------------------------------------------------------------------
    var experiments by mutableStateOf<List<Experiment>>(emptyList())
        private set
    var experimentsLoaded by mutableStateOf(false)
        private set
    var experimentsFailed by mutableStateOf(false)
        private set
    var busy by mutableStateOf<String?>(null)
        private set
    var notice by mutableStateOf<String?>(null)

    private fun say(key: String) { notice = key; scope.launch { kotlinx.coroutines.delay(3500); if (notice == key) notice = null } }

    fun loadExperiments() {
        val id = activeOrgId ?: return
        scope.launch {
            try {
                experiments = api.restGet(
                    "experiments", ListSerializer(ExperimentRow.serializer()),
                    "select" to "*,experiment_variants(*),experiment_questions(*,experiment_question_options(*))", "organization_id" to "eq.$id", "order" to "updated_at.desc",
                ).map { it.toExperiment() }
                experimentsLoaded = true; experimentsFailed = false
            } catch (e: CancellationException) { throw e } catch (e: Exception) { experimentsFailed = true; experimentsLoaded = true }
        }
    }

    /** Publishes a draft: the same update as the website (status, a public link, the time). */
    fun publish(e: Experiment) {
        busy = e.id
        scope.launch {
            try {
                api.restWrite(
                    HttpMethod.Patch, "experiments", listOf("id" to "eq.${e.id}"),
                    buildJsonObject { put("status", "published"); put("public_slug", newSlug()); put("published_at", isoNow()) },
                )
                say("experiments.published"); loadExperiments()
            } catch (x: CancellationException) { throw x } catch (x: Exception) { say("research.actionFailed") } finally { busy = null }
        }
    }

    fun delete(e: Experiment) {
        busy = e.id
        scope.launch {
            try {
                // the pictures of the variants live in storage under the experiment; the website removes them first, the app leaves them to the database cascade of the row only
                api.restWrite(HttpMethod.Delete, "experiments", listOf("id" to "eq.${e.id}"))
                experiments = experiments.filter { it.id != e.id }
                if (openId == e.id) closeExperiment()
            } catch (x: CancellationException) { throw x } catch (x: Exception) { say("research.actionFailed") } finally { busy = null }
        }
    }

    internal fun newSlug(): String {
        val chars = "abcdefghjkmnpqrstuvwxyz23456789" // no look-alike characters, like the website
        return Platform.randomBytes(8).joinToString("") { chars[(it.toInt() and 0xFF) % chars.length].toString() }
    }

    private fun isoNow(): String {
        val ms = Platform.nowMillis(); val days = ms.floorDiv(86_400_000L); val (y, mo, d) = space.affinix.app.civil(days)
        val s = (ms - days * 86_400_000L) / 1000
        fun two(n: Long) = n.toString().padStart(2, '0')
        return "$y-${two(mo.toLong())}-${two(d.toLong())}T${two(s / 3600)}:${two(s / 60 % 60)}:${two(s % 60)}Z"
    }

    /** where a published experiment is answered */
    fun publicLink(e: Experiment): String? = e.publicSlug?.let { "https://affinix.space/#/research/$it" }

    // ---- results of one experiment ---------------------------------------------------------------------------------------------
    var openId by mutableStateOf<String?>(null)
        private set
    var sessions by mutableStateOf<List<ParticipantSession>>(emptyList())
        private set
    var sessionsLoaded by mutableStateOf(false)
        private set
    var sessionsFailed by mutableStateOf(false)
        private set
    var segmentKey by mutableStateOf("ageRange")

    val openExperiment: Experiment? get() = experiments.firstOrNull { it.id == openId }

    fun openExperiment(id: String) { openId = id; sessions = emptyList(); sessionsLoaded = false; sessionsFailed = false; loadSessions() }
    fun closeExperiment() { openId = null; sessions = emptyList() }

    fun loadSessions() {
        val id = openId ?: return
        scope.launch {
            try {
                val rows = api.restGet("participant_sessions", ListSerializer(SessionRow.serializer()), "select" to "*,responses(*)", "experiment_id" to "eq.$id", "order" to "started_at.desc")
                if (openId == id) { sessions = rows.map { it.toSession() }; sessionsLoaded = true; sessionsFailed = false }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { if (openId == id) { sessionsFailed = true; sessionsLoaded = true } }
        }
    }

    // ---- participants of the whole company ---------------------------------------------------------------------------------
    var orgSessions by mutableStateOf<List<ParticipantSession>>(emptyList())
        private set
    var orgSessionsLoaded by mutableStateOf(false)
        private set
    var orgSessionsFailed by mutableStateOf(false)
        private set

    fun loadOrgSessions() {
        val id = activeOrgId ?: return
        scope.launch {
            try {
                orgSessions = api.restGet(
                    "participant_sessions", ListSerializer(SessionRow.serializer()),
                    "select" to "*,experiments!inner(id,name,organization_id)", "experiments.organization_id" to "eq.$id", "order" to "started_at.desc", "limit" to "500",
                ).map { it.toSession() }
                orgSessionsLoaded = true; orgSessionsFailed = false
            } catch (e: CancellationException) { throw e } catch (e: Exception) { orgSessionsFailed = true; orgSessionsLoaded = true }
        }
    }

    // ---- team ------------------------------------------------------------------------------------------------------------------------
    var members by mutableStateOf<List<Member>>(emptyList())
        private set
    var membersLoaded by mutableStateOf(false)
        private set
    var membersFailed by mutableStateOf(false)
        private set

    fun loadMembers() {
        val id = activeOrgId ?: return
        scope.launch {
            try {
                members = api.restGet(
                    "organization_members", ListSerializer(MemberRow.serializer()),
                    "select" to "id,role,user_id,created_at,profile:profiles(full_name,email,avatar_url)", "organization_id" to "eq.$id", "order" to "created_at",
                ).map { r -> Member(r.id, r.userId, r.role, r.createdAt, r.profile?.fullName?.takeIf { it.isNotBlank() } ?: r.profile?.email ?: "—", r.profile?.email.orEmpty(), r.profile?.avatarUrl) }
                membersLoaded = true; membersFailed = false
            } catch (e: CancellationException) { throw e } catch (e: Exception) { membersFailed = true; membersLoaded = true }
        }
    }

    fun setRole(m: Member, role: String) {
        val before = members
        members = members.map { if (it.id == m.id) it.copy(role = role) else it }
        scope.launch {
            try { api.restWrite(HttpMethod.Patch, "organization_members", listOf("id" to "eq.${m.id}"), buildJsonObject { put("role", role) }) }
            catch (e: CancellationException) { throw e } catch (e: Exception) { members = before; say("research.actionFailed") }
        }
    }

    fun remove(m: Member) {
        val before = members
        members = members.filter { it.id != m.id }
        scope.launch {
            try { api.restWrite(HttpMethod.Delete, "organization_members", listOf("id" to "eq.${m.id}")) }
            catch (e: CancellationException) { throw e } catch (e: Exception) { members = before; say("research.actionFailed") }
        }
    }

    /**
     * Adds a person by e-mail: someone who already has an account is added at once (add_member_by_email); otherwise the website's invite-member function sends an invite.
     * Returns "added" or "invited", or "error:<message>".
     */
    suspend fun addMember(email: String, role: String): String {
        val org = activeOrgId ?: return "error:"
        return try {
            api.rpcText("add_member_by_email", buildJsonObject { put("org_id", org); put("member_email", email.trim()); put("member_role", role) })
            loadMembers(); "added"
        } catch (e: CancellationException) { throw e } catch (e: ApiException) {
            if (!Regex("no account found", RegexOption.IGNORE_CASE).containsMatchIn(e.message)) return "error:${e.message}"
            try {
                api.invokeFunction("invite-member", buildJsonObject { put("org_id", org); put("email", email.trim()); put("role", role) })
                "invited"
            } catch (x: CancellationException) { throw x } catch (x: Exception) { "error:${(x as? ApiException)?.message.orEmpty()}" }
        } catch (e: Exception) { "error:" }
    }

    companion object { val ROLES = listOf("admin", "researcher", "viewer") }
}
