package space.affinix.app

import java.util.TimeZone
import java.util.UUID

actual object Platform {
    actual fun nowMillis(): Long = System.currentTimeMillis()
    actual fun tzOffsetMinutes(): Int = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000
    actual fun uuid(): String = UUID.randomUUID().toString()
}
