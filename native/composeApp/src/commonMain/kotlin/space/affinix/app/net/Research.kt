package space.affinix.app.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

// Rows of the website's research tables (PostgREST) and the shapes the app works with, mapped the way src/lib/experiments.js and participants.js map them.

@Serializable
data class OrgInfo(val id: String, val name: String = "", val slug: String? = null)

@Serializable
data class MemberOrgRow(val role: String = "member", val organization: OrgInfo? = null)

data class Org(val id: String, val name: String, val role: String)

@Serializable
data class VariantRow(
    val id: String, val label: String = "", val name: String = "", val description: String? = null,
    @SerialName("asset_url") val assetUrl: String? = null, @SerialName("asset_type") val assetType: String? = null, val color: String? = null, val position: Int = 0,
)

@Serializable
data class OptionRow(val label: String = "", val position: Int = 0)

@Serializable
data class QuestionRow(
    val id: String, val type: String = "single_choice", @SerialName("applies_to") val appliesTo: String? = null, val role: String? = null, val prompt: String = "",
    val scale: JsonElement? = null, val required: Boolean = true, val position: Int = 0,
    @SerialName("experiment_question_options") val options: List<OptionRow> = emptyList(),
)

@Serializable
data class ExperimentRow(
    val id: String, @SerialName("organization_id") val organizationId: String = "", val name: String = "", val description: String? = null, val objective: String? = null,
    val category: String? = null, val language: String? = null, @SerialName("research_type") val researchType: String? = null,
    @SerialName("target_audience") val targetAudience: String? = null, val status: String = "draft", @SerialName("public_slug") val publicSlug: String? = null,
    @SerialName("participant_limit") val participantLimit: Int? = null, @SerialName("participant_settings") val participantSettings: JsonObject? = null,
    @SerialName("created_at") val createdAt: String = "", @SerialName("updated_at") val updatedAt: String = "", @SerialName("published_at") val publishedAt: String? = null,
    @SerialName("experiment_variants") val variants: List<VariantRow> = emptyList(),
    @SerialName("experiment_questions") val questions: List<QuestionRow> = emptyList(),
)

data class Variant(val id: String, val label: String, val name: String, val description: String?, val assetUrl: String?, val color: String?)

data class Question(val id: String, val type: String, val appliesTo: String?, val role: String?, val prompt: String, val required: Boolean, val options: List<String>?)

data class Experiment(
    val id: String, val orgId: String, val name: String, val objective: String?, val researchType: String?, val status: String, val publicSlug: String?,
    val targetCount: Int, val createdAt: String, val updatedAt: String, val variants: List<Variant>, val questions: List<Question>,
)

/** the same mapping as mapExperiment: variants and questions in their order; the target is the participant limit unless the settings say otherwise */
fun ExperimentRow.toExperiment(): Experiment = Experiment(
    id, organizationId, name, objective, researchType, status, publicSlug,
    (participantSettings?.get("targetCount") as? JsonPrimitive)?.intOrNull ?: participantLimit ?: 0,
    createdAt, updatedAt,
    variants.sortedBy { it.position }.map { Variant(it.id, it.label, it.name, it.description, it.assetUrl, it.color) },
    questions.sortedBy { it.position }.map { q -> Question(q.id, q.type, q.appliesTo, q.role, q.prompt, q.required, q.options.sortedBy { it.position }.map { it.label }.takeIf { it.isNotEmpty() }) },
)

@Serializable
data class ResponseRow(
    @SerialName("question_id") val questionId: String, @SerialName("variant_id") val variantId: String? = null, val value: JsonElement? = null,
    @SerialName("response_time_ms") val responseTimeMs: Long? = null, @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class SessionRowExperiment(val id: String = "", val name: String? = null)

@Serializable
data class SessionRow(
    val id: String, @SerialName("experiment_id") val experimentId: String = "", val status: String = "in_progress",
    @SerialName("started_at") val startedAt: String = "", @SerialName("completed_at") val completedAt: String? = null,
    val demographics: JsonObject? = null, val responses: List<ResponseRow> = emptyList(), val experiments: SessionRowExperiment? = null,
)

data class Resp(val questionId: String, val variantId: String?, val value: JsonElement?, val responseTimeMs: Long?)

data class ParticipantSession(
    val id: String, val experimentId: String, val status: String, val startedAt: String, val completedAt: String?, val demographics: Map<String, String>,
    val responses: List<Resp>, val experimentName: String? = null,
)

fun SessionRow.toSession(): ParticipantSession = ParticipantSession(
    id, experimentId, status, startedAt, completedAt,
    demographics?.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.contentOrNull?.let { k to it } }?.toMap() ?: emptyMap(),
    responses.map { Resp(it.questionId, it.variantId, it.value, it.responseTimeMs) }, experiments?.name,
)
