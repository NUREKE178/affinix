package space.affinix.app.net

/** A tiny persistent string store (a JSON file on desktop, SharedPreferences on Android). */
interface KeyValueStore {
    fun get(key: String): String?
    fun put(key: String, value: String?)
}

class MemoryKeyValueStore : KeyValueStore {
    private val m = HashMap<String, String>()
    override fun get(key: String) = m[key]
    override fun put(key: String, value: String?) { if (value == null) m.remove(key) else m[key] = value }
}

class StoredSession(private val kv: KeyValueStore) : SessionStore {
    override fun load(): Session? = kv.get("session")?.let { runCatching { ApiJson.decodeFromString(Session.serializer(), it) }.getOrNull() }
    override fun save(session: Session?) = kv.put("session", session?.let { ApiJson.encodeToString(Session.serializer(), it) })
}
