package space.affinix.app.net

/** Keeps the signed-in session between launches (a file in the user's config folder on desktop, SharedPreferences on Android). */
interface SessionStore {
    fun load(): Session?
    fun save(session: Session?)
}

class MemorySessionStore(private var value: Session? = null) : SessionStore {
    override fun load() = value
    override fun save(session: Session?) { value = session }
}
