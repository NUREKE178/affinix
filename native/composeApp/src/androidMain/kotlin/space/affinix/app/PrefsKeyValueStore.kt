package space.affinix.app

import android.content.Context
import space.affinix.app.net.KeyValueStore

/** Settings and the signed-in session in the app's private SharedPreferences (not included in backups: see allowBackup in the manifest). */
class PrefsKeyValueStore(context: Context) : KeyValueStore {
    private val prefs = context.getSharedPreferences("affinix", Context.MODE_PRIVATE)
    override fun get(key: String): String? = prefs.getString(key, null)
    override fun put(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
}
