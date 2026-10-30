package space.affinix.app.i18n

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf

enum class Lang(val tag: String, val label: String) {
    Ru("ru", "Русский"), Kk("kk", "Қазақша"), En("en", "English");

    companion object {
        fun of(tag: String?): Lang? = entries.firstOrNull { it.tag == tag }
    }
}

private fun table(lang: Lang) = when (lang) { Lang.Ru -> STRINGS_RU; Lang.Kk -> STRINGS_KK; Lang.En -> STRINGS_EN }

/** The text for [key] in [lang], with `{name}` placeholders filled from [vars]. A key missing in a language falls back to English. */
fun tr(lang: Lang, key: String, vararg vars: Pair<String, Any>): String {
    var s = table(lang)[key] ?: STRINGS_EN[key] ?: key
    for ((k, v) in vars) s = s.replace("{$k}", v.toString())
    return s
}

val LocalLang = compositionLocalOf { Lang.Ru }

@Composable
fun t(key: String, vararg vars: Pair<String, Any>): String = tr(LocalLang.current, key, *vars)

/** An award's name: the tiered ones ("votes_100") share one template per group, the others have their own. */
@Composable
fun badgeName(id: String): String {
    val m = Regex("^(votes|streak|daily|level)_(\\d+)$").matchEntire(id)
    return if (m != null) t("arena.badgeName.${m.groupValues[1]}", "n" to m.groupValues[2]) else t("arena.badge.$id.name")
}
