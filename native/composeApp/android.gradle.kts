// The Android half of the build. Applied from build.gradle.kts only with -PwithAndroid=true (the CI job): it needs Google's Maven and the Android SDK.
val appVersion = (findProperty("appVersion") as String?) ?: "0.1.0"
val appVersionCode = ((findProperty("appVersionCode") as String?) ?: "1").toInt()

// The signing key comes from the environment (the CI job creates a one-off one or takes yours from repository secrets); none is stored in the repository.
val ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
val ksPass = System.getenv("ANDROID_KEYSTORE_PASSWORD")
val ksAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "affinix"
val ksKeyPass = System.getenv("ANDROID_KEY_PASSWORD") ?: ksPass

configure<com.android.build.api.dsl.ApplicationExtension> {
    namespace = "space.affinix.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "space.affinix.app"
        minSdk = 24
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersion
    }

    if (ksPath != null) {
        signingConfigs {
            create("release") {
                storeFile = file(ksPath)
                storePassword = ksPass
                keyAlias = ksAlias
                keyPassword = ksKeyPass
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = if (ksPath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/INDEX.LIST", "/META-INF/io.netty.versions.properties")
    }

    lint { abortOnError = false }
}
