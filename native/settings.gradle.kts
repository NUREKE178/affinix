rootProject.name = "affinix-native"

// Google's Maven hosts the androidx libraries that Compose (desktop included) depends on. Only a sandbox that cannot reach it passes -PnoGoogle=true.
val useGoogle = providers.gradleProperty("noGoogle").orNull != "true"

pluginManagement {
    val useGoogle = providers.gradleProperty("noGoogle").orNull != "true"
    repositories {
        gradlePluginPortal()
        mavenCentral()
        if (useGoogle) google()
    }
}
dependencyResolutionManagement {
    repositories {
        mavenCentral()
        if (useGoogle) google()
    }
}
include(":composeApp")
