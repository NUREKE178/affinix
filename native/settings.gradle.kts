rootProject.name = "affinix-native"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        // Google's Maven is only needed for the Android build (CI): -PwithAndroid=true
        if (providers.gradleProperty("withAndroid").orNull == "true") google()
    }
}
dependencyResolutionManagement {
    repositories {
        mavenCentral()
        if (providers.gradleProperty("withAndroid").orNull == "true") google()
    }
}
include(":composeApp")
