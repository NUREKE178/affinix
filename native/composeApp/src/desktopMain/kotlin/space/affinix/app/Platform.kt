package space.affinix.app

import java.util.TimeZone
import java.util.UUID

actual object Platform {
    actual fun nowMillis(): Long = System.currentTimeMillis()
    actual fun tzOffsetMinutes(): Int = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000
    actual fun uuid(): String = UUID.randomUUID().toString()
    actual fun languageTag(): String = java.util.Locale.getDefault().language
    actual fun sha256(data: ByteArray): ByteArray = java.security.MessageDigest.getInstance("SHA-256").digest(data)
    actual fun randomBytes(n: Int): ByteArray = ByteArray(n).also { java.security.SecureRandom().nextBytes(it) }
}
