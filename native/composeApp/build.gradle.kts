import org.jetbrains.compose.desktop.application.dsl.TargetFormat

val withAndroid = (findProperty("withAndroid") as String?) == "true"
val appVersion = (findProperty("appVersion") as String?) ?: "1.0.0"
val appVersionCode = ((findProperty("appVersionCode") as String?) ?: "1").toInt()

plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.compose")
}
if (withAndroid) apply(plugin = "com.android.application")

kotlin {
    jvmToolchain(21)
    if (withAndroid) androidTarget()
    jvm("desktop")

    sourceSets {
        val commonMain by getting {
            dependencies {
                implementation(compose.runtime)
                implementation(compose.foundation)
                implementation(compose.ui)
                implementation(compose.components.resources)
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
                implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
                implementation("io.ktor:ktor-client-core:3.0.1")
                implementation("io.ktor:ktor-client-content-negotiation:3.0.1")
                implementation("io.ktor:ktor-serialization-kotlinx-json:3.0.1")
            }
        }
        val commonTest by getting {
            dependencies {
                implementation(kotlin("test"))
                implementation("io.ktor:ktor-client-mock:3.0.1")
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
            }
        }
        val desktopMain by getting {
            dependencies {
                implementation(compose.desktop.currentOs)
                implementation("io.ktor:ktor-client-okhttp:3.0.1")
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-swing:1.9.0")
            }
        }
        val desktopTest by getting {
            dependencies { implementation(compose.desktop.currentOs) }
        }
        if (withAndroid) {
            val androidMain by getting {
                dependencies {
                    implementation("io.ktor:ktor-client-okhttp:3.0.1")
                    implementation("androidx.activity:activity-compose:1.9.3")
                    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
                }
            }
        }
    }
}

compose.resources {
    packageOfResClass = "space.affinix.app.res"
    generateResClass = always
}

compose.desktop {
    application {
        mainClass = "space.affinix.app.MainKt"
        nativeDistributions {
            targetFormats(TargetFormat.Deb, TargetFormat.Msi, TargetFormat.Exe, TargetFormat.AppImage)
            packageName = "Affinix"
            packageVersion = appVersion
        }
    }
}
