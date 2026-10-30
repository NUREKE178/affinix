package space.affinix.app

import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import space.affinix.app.net.ApiJson
import space.affinix.app.net.KeyValueStore
import java.io.File

/** Settings and the signed-in session in one small JSON file in the user's config folder (readable by the user only where the OS allows). */
class FileKeyValueStore(private val file: File) : KeyValueStore {
    private val ser = MapSerializer(String.serializer(), String.serializer())
    private val map: MutableMap<String, String> = runCatching { ApiJson.decodeFromString(ser, file.readText()).toMutableMap() }.getOrDefault(mutableMapOf())

    @Synchronized override fun get(key: String) = map[key]

    @Synchronized override fun put(key: String, value: String?) {
        if (value == null) map.remove(key) else map[key] = value
        runCatching {
            file.parentFile?.mkdirs()
            val tmp = File(file.path + ".tmp")
            tmp.writeText(ApiJson.encodeToString(ser, map))
            tmp.setReadable(false, false); tmp.setReadable(true, true); tmp.setWritable(false, false); tmp.setWritable(true, true)
            tmp.renameTo(file).also { if (!it) { file.writeText(tmp.readText()); tmp.delete() } }
        }
    }

    companion object {
        fun configDir(): File {
            val os = System.getProperty("os.name").lowercase()
            val home = System.getProperty("user.home")
            val base = when {
                "win" in os -> File(System.getenv("APPDATA") ?: "$home/AppData/Roaming")
                "mac" in os -> File("$home/Library/Application Support")
                else -> File(System.getenv("XDG_CONFIG_HOME") ?: "$home/.config")
            }
            return File(base, "Affinix")
        }
        fun default() = FileKeyValueStore(File(configDir(), "store.json"))
    }
}
