package space.affinix.app.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray

@Serializable
data class Session(
    val accessToken: String,
    val refreshToken: String,
    /** epoch seconds when the access token stops being valid */
    val expiresAt: Long,
    val userId: String,
    val email: String = "",
)

@Serializable
data class Specimen(val name: String = "", val contrast: Double? = null, val size: Double? = null)

/** One duel dealt by /api/arena-deal. `a`/`b` are canonical pool indices; `swap` says the screen shows them the other way round. */
@Serializable
data class Duel(
    val id: String,
    val season: String,
    val family: String,
    val dim: String,
    val a: Int,
    val b: Int,
    val pair: String,
    val swap: Boolean = false,
    val objective: Boolean = false,
    val repeat: Boolean = false,
    val daily: Boolean = false,
    val set: Int = 0,
    val truth: Int? = null,
    val specimens: List<Specimen> = emptyList(),
)

@Serializable
data class TallySide(val w: Int = 0, val l: Int = 0)

@Serializable
data class Tally(val pair: String = "", val dim: String = "", val a: Int = 0, val b: Int = 0, val sa: TallySide = TallySide(), val sb: TallySide = TallySide()) {
    val total get() = a + b
}

@Serializable
data class Profile(
    val xp: Long = 0,
    val level: Int = 1,
    val votes: Int = 0,
    val eyeCorrect: Int = 0,
    val eyeTotal: Int = 0,
    val crowdHits: Int = 0,
    val crowdTotal: Int = 0,
    val bestCombo: Int = 0,
    val streak: Int = 0,
    val bestStreak: Int = 0,
    val lastDay: String? = null,
    val dailySets: Int = 0,
    val visible: Boolean = true,
    val badges: List<String> = emptyList(),
)

@Serializable
data class DayStats(
    val day: String = "",
    val votes: Int = 0,
    val xp: Long = 0,
    val sec: Int = 0,
    val dailyVotes: Int = 0,
    val maxCombo: Int = 0,
    val eyeCorrect: Int = 0,
    val families: List<String> = emptyList(),
    val dims: List<String> = emptyList(),
    val slate: List<String> = emptyList(),
    val claimed: List<String> = emptyList(),
    /** answered duels of the extra sets 2..6 (migration 0023); empty on a server that does not have it */
    val setVotes: List<Int> = emptyList(),
    val familyVotes: Map<String, Int> = emptyMap(),
) {
    /** The day's value of the counter a quest of this kind watches. */
    fun metric(kind: String): Int = when (kind) {
        "votes" -> votes; "families" -> families.size; "dims" -> dims.size; "combo" -> maxCombo; "eye" -> eyeCorrect; "time" -> sec; else -> 0
    }
}

@Serializable
data class ClaimResponse(val ok: Boolean = false, val reason: String? = null, val state: StateResponse? = null, val newBadges: List<String> = emptyList())

@Serializable
data class StateResponse(val profile: Profile = Profile(), val today: DayStats? = null, val serverDay: String? = null, val days: List<DayStats> = emptyList())

@Serializable
data class SubmitResponse(val state: StateResponse? = null, val newBadges: List<String> = emptyList())

@Serializable
data class WireVote(
    val id: String,
    val pair: String,
    val dim: String,
    val pick: Int,
    val ms: Long,
    val bonus: Int,
    val day: String,
    val daily: Boolean,
    val set: Int? = null,
    val eye: Boolean? = null,
    val combo: Int,
)

@Serializable
data class TallyQuery(val pair: String, val dim: String)

@Serializable
data class MyVotes(val rows: List<JsonArray> = emptyList(), val last: Long = 0, val more: Boolean = false)

@Serializable
data class LeaderRow(
    val rank: Int = 0,
    val userId: String = "",
    val name: String = "",
    val username: String? = null,
    val avatarUrl: String? = null,
    val xp: Long = 0,
    val level: Int = 1,
    val streak: Int = 0,
    val isMe: Boolean = false,
)

@Serializable
data class LeaderMe(val rank: Int? = null, val xp: Long = 0)

@Serializable
data class Leaderboard(val rows: List<LeaderRow> = emptyList(), val me: LeaderMe? = null, val weekStart: String? = null)

/** Subset of the GoTrue token response. */
@Serializable
internal data class TokenResponse(
    @SerialName("access_token") val accessToken: String? = null,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("expires_in") val expiresIn: Long = 3600,
    @SerialName("expires_at") val expiresAt: Long? = null,
    val user: TokenUser? = null,
    // errors come back in the same shape family
    @SerialName("error_description") val errorDescription: String? = null,
    val msg: String? = null,
    val message: String? = null,
    @SerialName("error_code") val errorCode: String? = null,
)

@Serializable
internal data class TokenUser(val id: String = "", val email: String? = null)

/** My own row of `profiles` (the columns the app edits). */
@Serializable
data class MyProfileRow(
    @SerialName("full_name") val fullName: String? = null,
    val username: String? = null,
    @SerialName("role_title") val roleTitle: String? = null,
    val bio: String? = null,
)
